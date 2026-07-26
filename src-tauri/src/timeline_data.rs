//! Bounded timeline pages backed by aggregate SQL reads.
//!
//! The legacy timeline path materialized every activity log (including notes)
//! before reducing them to one or two lifecycle events per title. This module
//! reads only grouped totals and dominant activity-type rows inside a single
//! transaction, then filters and pages the compact event set.

use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::{Connection, Result};

use crate::models::{
    TimelineBucket, TimelineBucketGranularity, TimelineBucketHighlight, TimelineBucketMilestone,
    TimelineBucketPage, TimelineBucketRequest, TimelineEvent, TimelineEventKind, TimelinePage,
    TimelinePageRequest, TimelineSummary,
};
use crate::read_performance::{Measured, Timings};

pub const MAX_TIMELINE_PAGE_SIZE: i64 = 100;
const MAX_TIMELINE_OFFSET: i64 = 1_000_000;
const MAX_TIMELINE_SEARCH_CHARS: usize = 200;
const MAX_TIMELINE_BUCKET_HIGHLIGHTS: usize = 6;
const MAX_TIMELINE_BUCKET_MILESTONES: usize = 4;
const MAX_TIMELINE_BUCKETS: usize = 600;

#[derive(Clone)]
struct TimelineMediaContext {
    media_id: i64,
    media_title: String,
    media_variant: String,
    cover_image: String,
    activity_type: String,
    content_type: String,
    tracking_status: String,
    first_date: String,
    last_date: String,
    total_minutes: i64,
    total_characters: i64,
    same_day_terminal: bool,
}

struct TimelineMediaRow {
    media_id: i64,
    media_title: String,
    media_variant: String,
    cover_image: String,
    fallback_activity_type: String,
    content_type: String,
    tracking_status: String,
    first_date: Option<String>,
    last_date: Option<String>,
    total_minutes: i64,
    total_characters: i64,
}

pub fn validate_page_request(request: &TimelinePageRequest) -> std::result::Result<(), String> {
    if request.offset < 0 || request.offset > MAX_TIMELINE_OFFSET {
        return Err(format!(
            "timeline offset must be between 0 and {MAX_TIMELINE_OFFSET}"
        ));
    }
    if !(1..=MAX_TIMELINE_PAGE_SIZE).contains(&request.limit) {
        return Err(format!(
            "timeline limit must be between 1 and {MAX_TIMELINE_PAGE_SIZE}"
        ));
    }
    if request
        .year
        .is_some_and(|year| !(1..=9_999).contains(&year))
    {
        return Err("timeline year must be between 1 and 9999".to_string());
    }
    if request.search_query.chars().count() > MAX_TIMELINE_SEARCH_CHARS {
        return Err(format!(
            "timeline search is limited to {MAX_TIMELINE_SEARCH_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn validate_bucket_request(
    request: &TimelineBucketRequest,
) -> std::result::Result<(), String> {
    if request.search_query.chars().count() > MAX_TIMELINE_SEARCH_CHARS {
        return Err(format!(
            "timeline search is limited to {MAX_TIMELINE_SEARCH_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn get_timeline_page(
    conn: &Connection,
    request: &TimelinePageRequest,
) -> Result<Measured<TimelinePage>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let all_events = query_timeline_events(&transaction, &mut timings)?;

    let page = timings.aggregate(|| build_page(all_events, request));
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(page))
}

pub fn get_timeline_buckets(
    conn: &Connection,
    request: &TimelineBucketRequest,
) -> Result<Measured<TimelineBucketPage>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let all_events = query_timeline_events(&transaction, &mut timings)?;
    let month_totals = query_media_month_totals(&transaction, &mut timings)?;
    let page = timings.aggregate(|| build_bucket_page(all_events, month_totals, request));
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(page))
}

/// Compatibility entrypoint for the public `/timeline` API and existing tests.
/// It uses the same aggregate query but intentionally does not page the result.
pub fn get_all_timeline_events(conn: &Connection) -> Result<Vec<TimelineEvent>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let events = query_timeline_events(&transaction, &mut timings)?;
    timings.query(|| transaction.commit())?;
    Ok(events)
}

fn query_timeline_events(conn: &Connection, timings: &mut Timings) -> Result<Vec<TimelineEvent>> {
    let media_rows = query_media_rows(conn, timings)?;
    let dominant_activity_types = query_dominant_activity_types(conn, timings)?;

    let mut contexts = HashMap::<i64, TimelineMediaContext>::new();
    let mut events = Vec::new();

    timings.aggregate(|| {
        for row in media_rows {
            let has_logs = row.first_date.is_some() && row.last_date.is_some();
            let first_date = row.first_date.unwrap_or_default();
            let last_date = row.last_date.unwrap_or_default();
            let terminal_event = terminal_kind(&row.tracking_status);
            let same_day_terminal = has_logs && terminal_event.is_some() && first_date == last_date;
            let context = TimelineMediaContext {
                media_id: row.media_id,
                media_title: row.media_title,
                media_variant: row.media_variant,
                cover_image: row.cover_image,
                activity_type: dominant_activity_types
                    .get(&row.media_id)
                    .cloned()
                    .unwrap_or(row.fallback_activity_type),
                content_type: row.content_type,
                tracking_status: row.tracking_status,
                first_date: first_date.clone(),
                last_date: last_date.clone(),
                total_minutes: row.total_minutes,
                total_characters: row.total_characters,
                same_day_terminal,
            };
            contexts.insert(row.media_id, context.clone());

            if !has_logs {
                continue;
            }

            if let Some(kind) = terminal_event {
                events.push(build_timeline_event(
                    &context, kind, last_date, None, None, 0, 0,
                ));
                if !same_day_terminal {
                    events.push(build_timeline_event(
                        &context,
                        TimelineEventKind::Started,
                        first_date,
                        None,
                        None,
                        0,
                        0,
                    ));
                }
            } else {
                events.push(build_timeline_event(
                    &context,
                    TimelineEventKind::Started,
                    first_date,
                    None,
                    None,
                    0,
                    0,
                ));
            }
        }
    });

    let milestone_rows = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT milestone.id, milestone.name, milestone.duration,
                    milestone.characters, milestone.date, media.id
             FROM main.milestones milestone
             JOIN shared.media media ON media.uid = milestone.media_uid
             WHERE milestone.date IS NOT NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    timings.aggregate(|| {
        for (milestone_id, name, duration, characters, date, media_id) in milestone_rows {
            let Some(context) = contexts.get(&media_id) else {
                continue;
            };
            events.push(build_timeline_event(
                context,
                TimelineEventKind::Milestone,
                date,
                Some(name),
                milestone_id,
                duration,
                characters,
            ));
        }

        events.sort_by(|left, right| {
            right
                .date
                .cmp(&left.date)
                .then_with(|| timeline_sort_rank(left).cmp(&timeline_sort_rank(right)))
                .then_with(|| left.media_title.cmp(&right.media_title))
                .then_with(|| left.media_id.cmp(&right.media_id))
                .then_with(|| right.milestone_id.cmp(&left.milestone_id))
        });
    });

    Ok(events)
}

fn query_media_rows(conn: &Connection, timings: &mut Timings) -> Result<Vec<TimelineMediaRow>> {
    timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT media.id, media.title, media.variant, media.cover_image,
                    media.default_activity_type, media.content_type,
                    media.tracking_status, MIN(log.date), MAX(log.date),
                    COALESCE(SUM(log.duration_minutes), 0),
                    COALESCE(SUM(log.characters), 0)
             FROM shared.media media
             LEFT JOIN main.activity_logs log ON log.media_id = media.id
             GROUP BY media.id, media.title, media.variant, media.cover_image,
                      media.default_activity_type, media.content_type,
                      media.tracking_status",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(TimelineMediaRow {
                media_id: row.get(0)?,
                media_title: row.get(1)?,
                media_variant: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                cover_image: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                fallback_activity_type: row.get(4)?,
                content_type: row
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "Unknown".to_string()),
                tracking_status: row
                    .get::<_, Option<String>>(6)?
                    .unwrap_or_else(|| "Untracked".to_string()),
                first_date: row.get(7)?,
                last_date: row.get(8)?,
                total_minutes: row.get(9)?,
                total_characters: row.get(10)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })
}

fn query_dominant_activity_types(
    conn: &Connection,
    timings: &mut Timings,
) -> Result<HashMap<i64, String>> {
    let rows = timings.query(|| {
        let mut statement = conn.prepare(
            "WITH activity_counts AS (
                 SELECT media_id, activity_type, COUNT(*) AS activity_count
                 FROM main.activity_logs
                 GROUP BY media_id, activity_type
             )
             SELECT counts.media_id, counts.activity_type, counts.activity_count,
                    (
                        SELECT recent.date
                        FROM main.activity_logs recent
                        WHERE recent.media_id = counts.media_id
                          AND recent.activity_type = counts.activity_type
                        ORDER BY recent.date DESC, recent.id DESC
                        LIMIT 1
                    ) AS latest_date,
                    (
                        SELECT recent.id
                        FROM main.activity_logs recent
                        WHERE recent.media_id = counts.media_id
                          AND recent.activity_type = counts.activity_type
                        ORDER BY recent.date DESC, recent.id DESC
                        LIMIT 1
                    ) AS latest_id
             FROM activity_counts counts
             ORDER BY counts.media_id ASC, counts.activity_count DESC,
                      latest_date DESC, latest_id DESC, counts.activity_type ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    Ok(timings.aggregate(|| {
        let mut dominant = HashMap::new();
        for (media_id, activity_type) in rows {
            dominant.entry(media_id).or_insert(activity_type);
        }
        dominant
    }))
}

/// One row per (media, month) with logged minutes/characters summed across
/// `activity_logs`. This is intentionally independent of any lifecycle event:
/// a title read across several months logs time in all of them even though it
/// only ever produces one or two timeline events.
fn query_media_month_totals(
    conn: &Connection,
    timings: &mut Timings,
) -> Result<Vec<(i64, String, i64, i64)>> {
    timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT media_id,
                    substr(date, 1, 7),
                    COALESCE(SUM(duration_minutes), 0),
                    COALESCE(SUM(characters), 0)
             FROM main.activity_logs
             WHERE date <> ''
             GROUP BY media_id, substr(date, 1, 7)",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })
}

fn compute_available_years(events: &[TimelineEvent]) -> Vec<i32> {
    events
        .iter()
        .filter_map(|event| event.date.get(0..4)?.parse::<i32>().ok())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn compute_ambiguous_titles(events: &[TimelineEvent]) -> Vec<String> {
    let mut media_ids_by_title = HashMap::<String, HashSet<i64>>::new();
    for event in events {
        media_ids_by_title
            .entry(event.media_title.clone())
            .or_default()
            .insert(event.media_id);
    }
    let mut ambiguous_titles = media_ids_by_title
        .into_iter()
        .filter_map(|(title, media_ids)| (media_ids.len() > 1).then_some(title))
        .collect::<Vec<_>>();
    ambiguous_titles.sort();
    ambiguous_titles
}

fn matches_year(event: &TimelineEvent, year: Option<i32>) -> bool {
    match year {
        None => true,
        Some(target) => {
            event
                .date
                .get(0..4)
                .and_then(|value| value.parse::<i32>().ok())
                == Some(target)
        }
    }
}

fn matches_kind(event: &TimelineEvent, kind: Option<&TimelineEventKind>) -> bool {
    match kind {
        None => true,
        Some(target) => &event.kind == target,
    }
}

fn matches_search(event: &TimelineEvent, normalized_query: &str) -> bool {
    normalized_query.is_empty()
        || event.media_title.to_lowercase().contains(normalized_query)
        || event
            .media_variant
            .to_lowercase()
            .contains(normalized_query)
        || event
            .milestone_name
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .contains(normalized_query)
        || event
            .activity_type
            .to_lowercase()
            .contains(normalized_query)
        || event
            .content_type
            .to_lowercase()
            .contains(normalized_query)
}

fn build_page(events: Vec<TimelineEvent>, request: &TimelinePageRequest) -> TimelinePage {
    let all_event_count = i64::try_from(events.len()).unwrap_or(i64::MAX);
    let available_years = compute_available_years(&events);
    let ambiguous_titles = compute_ambiguous_titles(&events);
    let normalized_query = request.search_query.trim().to_lowercase();
    let filtered = events
        .into_iter()
        .filter(|event| {
            matches_year(event, request.year)
                && matches_kind(event, request.kind.as_ref())
                && matches_search(event, &normalized_query)
        })
        .collect::<Vec<_>>();

    let summary = summarize(&filtered);
    let total_count = i64::try_from(filtered.len()).unwrap_or(i64::MAX);
    let start = match request.anchor_date.as_deref() {
        // Events are sorted date-desc, so the first event with `date <= anchor` is the newest
        // event at or before the anchor — the top of the window we want to land on.
        Some(anchor) => filtered
            .iter()
            .position(|event| event.date.as_str() <= anchor)
            .unwrap_or(filtered.len()),
        None => usize::try_from(request.offset).unwrap_or(usize::MAX),
    }
    .min(filtered.len());
    let page_size = usize::try_from(request.limit).unwrap_or_default();
    let end = start.saturating_add(page_size).min(filtered.len());
    let page_events = filtered[start..end].to_vec();

    TimelinePage {
        request_id: request.request_id,
        offset: i64::try_from(start).unwrap_or(i64::MAX),
        limit: request.limit,
        total_count,
        all_event_count,
        has_more: end < filtered.len(),
        available_years,
        ambiguous_titles,
        summary,
        events: page_events,
    }
}

fn bucket_key_len(granularity: &TimelineBucketGranularity) -> usize {
    match granularity {
        TimelineBucketGranularity::Month => 7,
        TimelineBucketGranularity::Year => 4,
    }
}

fn bucket_start_date(key: &str, granularity: &TimelineBucketGranularity) -> String {
    match granularity {
        TimelineBucketGranularity::Month => format!("{key}-01"),
        TimelineBucketGranularity::Year => format!("{key}-01-01"),
    }
}

fn build_bucket_page(
    events: Vec<TimelineEvent>,
    month_totals: Vec<(i64, String, i64, i64)>,
    request: &TimelineBucketRequest,
) -> TimelineBucketPage {
    let available_years = compute_available_years(&events);
    let ambiguous_titles = compute_ambiguous_titles(&events);

    let normalized_query = request.search_query.trim().to_lowercase();
    let search_matched_events = events
        .into_iter()
        .filter(|event| matches_search(event, &normalized_query))
        .collect::<Vec<_>>();
    let search_matched_media = search_matched_events
        .iter()
        .map(|event| event.media_id)
        .collect::<HashSet<_>>();

    let filtered_events = search_matched_events
        .into_iter()
        .filter(|event| matches_year(event, request.year))
        .collect::<Vec<_>>();

    let summary = summarize(&filtered_events);
    let key_len = bucket_key_len(&request.granularity);

    // Bucket rows can exist with no lifecycle event at all, because logged time in
    // `activity_logs` is event-independent — a title read across several months only ever
    // produces one or two events. So the bucket set is the union of keys from `filtered_events`
    // and keys from the logged-time totals of media that survived the search filter. The year
    // filter then clips that key set at the end rather than narrowing `search_matched_media`
    // above: a media whose only event is in Dec 2023 but with logged time in Mar 2024 must still
    // produce a March 2024 bucket under `year: Some(2024)`, which only holds if the year filter
    // never touches which media's logs are eligible.
    let mut bucket_keys = BTreeSet::new();
    for event in &filtered_events {
        if let Some(key) = event.date.get(0..key_len) {
            bucket_keys.insert(key.to_string());
        }
    }
    for (media_id, month, _, _) in &month_totals {
        if !search_matched_media.contains(media_id) {
            continue;
        }
        if let Some(key) = month.get(0..key_len) {
            bucket_keys.insert(key.to_string());
        }
    }
    if let Some(year) = request.year {
        bucket_keys.retain(|key| {
            key.get(0..4).and_then(|value| value.parse::<i32>().ok()) == Some(year)
        });
    }

    let mut buckets = bucket_keys
        .into_iter()
        .map(|key| {
            let start_date = bucket_start_date(&key, &request.granularity);
            (
                key.clone(),
                TimelineBucket {
                    key,
                    start_date,
                    started_count: 0,
                    finished_count: 0,
                    paused_count: 0,
                    dropped_count: 0,
                    milestone_count: 0,
                    logged_minutes: 0,
                    logged_characters: 0,
                    highlights: Vec::new(),
                    highlight_overflow: 0,
                    milestones: Vec::new(),
                    milestone_overflow: 0,
                },
            )
        })
        .collect::<HashMap<String, TimelineBucket>>();

    for event in &filtered_events {
        let Some(key) = event.date.get(0..key_len) else {
            continue;
        };
        let Some(bucket) = buckets.get_mut(key) else {
            continue;
        };
        match event.kind {
            TimelineEventKind::Started => bucket.started_count += 1,
            TimelineEventKind::Finished => bucket.finished_count += 1,
            TimelineEventKind::Paused => bucket.paused_count += 1,
            TimelineEventKind::Dropped => bucket.dropped_count += 1,
            TimelineEventKind::Milestone => bucket.milestone_count += 1,
        }
    }

    for (media_id, month, minutes, characters) in &month_totals {
        if !search_matched_media.contains(media_id) {
            continue;
        }
        let Some(key) = month.get(0..key_len) else {
            continue;
        };
        let Some(bucket) = buckets.get_mut(key) else {
            continue;
        };
        bucket.logged_minutes += minutes;
        bucket.logged_characters += characters;
    }

    let mut bucket_distinct_media = HashMap::<String, HashSet<i64>>::new();
    for event in &filtered_events {
        if let Some(key) = event.date.get(0..key_len) {
            bucket_distinct_media
                .entry(key.to_string())
                .or_default()
                .insert(event.media_id);
        }
    }

    let mut bucket_highlight_seen = HashMap::<String, HashSet<i64>>::new();
    for event in &filtered_events {
        if !matches!(
            event.kind,
            TimelineEventKind::Started | TimelineEventKind::Finished
        ) {
            continue;
        }
        let Some(key) = event.date.get(0..key_len) else {
            continue;
        };
        if event.cover_image.is_empty() {
            continue;
        }
        let seen = bucket_highlight_seen.entry(key.to_string()).or_default();
        if !seen.insert(event.media_id) {
            continue;
        }
        let Some(bucket) = buckets.get_mut(key) else {
            continue;
        };
        if bucket.highlights.len() >= MAX_TIMELINE_BUCKET_HIGHLIGHTS {
            continue;
        }
        bucket.highlights.push(TimelineBucketHighlight {
            media_id: event.media_id,
            media_title: event.media_title.clone(),
            media_variant: event.media_variant.clone(),
            cover_image: event.cover_image.clone(),
        });
    }

    for event in &filtered_events {
        if event.kind != TimelineEventKind::Milestone {
            continue;
        }
        let Some(key) = event.date.get(0..key_len) else {
            continue;
        };
        let Some(bucket) = buckets.get_mut(key) else {
            continue;
        };
        if bucket.milestones.len() < MAX_TIMELINE_BUCKET_MILESTONES {
            bucket.milestones.push(TimelineBucketMilestone {
                milestone_id: event.milestone_id,
                media_id: event.media_id,
                name: event.milestone_name.clone().unwrap_or_default(),
            });
        }
    }

    for (key, bucket) in buckets.iter_mut() {
        let distinct = bucket_distinct_media.get(key).map_or(0, HashSet::len);
        let kept = bucket.highlights.len();
        bucket.highlight_overflow = i64::try_from(distinct.saturating_sub(kept)).unwrap_or(0);
        let milestone_overflow = bucket.milestone_count
            - i64::try_from(bucket.milestones.len()).unwrap_or(bucket.milestone_count);
        bucket.milestone_overflow = milestone_overflow.max(0);
    }

    let mut bucket_list = buckets.into_values().collect::<Vec<_>>();
    bucket_list.sort_by(|left, right| right.key.cmp(&left.key));
    bucket_list.truncate(MAX_TIMELINE_BUCKETS);

    TimelineBucketPage {
        request_id: request.request_id,
        granularity: request.granularity.clone(),
        available_years,
        ambiguous_titles,
        summary,
        buckets: bucket_list,
    }
}

fn summarize(events: &[TimelineEvent]) -> TimelineSummary {
    let mut media_totals = HashMap::<i64, (i64, i64)>::new();
    let mut completed_titles = HashSet::new();
    for event in events {
        media_totals
            .entry(event.media_id)
            .or_insert((event.total_minutes, event.total_characters));
        if event.kind == TimelineEventKind::Finished {
            completed_titles.insert(event.media_id);
        }
    }

    TimelineSummary {
        total_minutes: media_totals.values().map(|value| value.0).sum(),
        completed_titles: i64::try_from(completed_titles.len()).unwrap_or(i64::MAX),
        total_characters: media_totals.values().map(|value| value.1).sum(),
    }
}

fn terminal_kind(tracking_status: &str) -> Option<TimelineEventKind> {
    match tracking_status {
        "Complete" => Some(TimelineEventKind::Finished),
        "Paused" => Some(TimelineEventKind::Paused),
        "Dropped" => Some(TimelineEventKind::Dropped),
        _ => None,
    }
}

fn timeline_sort_rank(event: &TimelineEvent) -> u8 {
    let is_terminal = terminal_kind(&event.tracking_status).is_some();
    match event.kind {
        TimelineEventKind::Milestone if !is_terminal => 0,
        TimelineEventKind::Started => 1,
        TimelineEventKind::Finished | TimelineEventKind::Paused | TimelineEventKind::Dropped
            if event.same_day_terminal =>
        {
            2
        }
        TimelineEventKind::Finished | TimelineEventKind::Paused | TimelineEventKind::Dropped => 3,
        TimelineEventKind::Milestone => 4,
    }
}

fn build_timeline_event(
    context: &TimelineMediaContext,
    kind: TimelineEventKind,
    date: String,
    milestone_name: Option<String>,
    milestone_id: Option<i64>,
    milestone_minutes: i64,
    milestone_characters: i64,
) -> TimelineEvent {
    TimelineEvent {
        kind,
        date,
        media_id: context.media_id,
        media_title: context.media_title.clone(),
        media_variant: context.media_variant.clone(),
        cover_image: context.cover_image.clone(),
        activity_type: context.activity_type.clone(),
        content_type: context.content_type.clone(),
        tracking_status: context.tracking_status.clone(),
        milestone_name,
        milestone_id,
        first_date: context.first_date.clone(),
        last_date: context.last_date.clone(),
        total_minutes: context.total_minutes,
        total_characters: context.total_characters,
        milestone_minutes,
        milestone_characters,
        same_day_terminal: context.same_day_terminal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        models::{ActivityLog, Media, Milestone},
    };

    fn media(title: &str, tracking_status: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "description must not be read for timeline".to_string(),
            cover_image: String::new(),
            extra_data: "{\"large\":true}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: tracking_status.to_string(),
        }
    }

    #[test]
    fn validates_page_bounds() {
        let request = TimelinePageRequest {
            request_id: 1,
            year: None,
            kind: None,
            search_query: String::new(),
            offset: 0,
            limit: MAX_TIMELINE_PAGE_SIZE,
            anchor_date: None,
        };
        assert!(validate_page_request(&request).is_ok());
        assert!(validate_page_request(&TimelinePageRequest {
            limit: MAX_TIMELINE_PAGE_SIZE + 1,
            ..request.clone()
        })
        .is_err());
        assert!(validate_page_request(&TimelinePageRequest {
            offset: -1,
            ..request
        })
        .is_err());
    }

    #[test]
    fn pages_compact_events_and_echoes_request_identity() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("timeline-test")).unwrap();
        let completed_id = db::add_media_with_id(&conn, &media("Completed", "Complete")).unwrap();
        let ongoing_id = db::add_media_with_id(&conn, &media("Ongoing", "Ongoing")).unwrap();
        for (media_id, date, minutes) in [
            (completed_id, "2025-01-01", 30),
            (completed_id, "2026-01-02", 60),
            (ongoing_id, "2026-02-03", 15),
        ] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: "large notes must not be returned".to_string(),
                },
            )
            .unwrap();
        }
        let completed_media = db::get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|item| item.id == Some(completed_id))
            .unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: completed_media.uid,
                media_title: String::new(),
                name: "Halfway".to_string(),
                duration: 45,
                characters: 0,
                date: Some("2026-01-15".to_string()),
            },
        )
        .unwrap();

        let page = get_timeline_page(
            &conn,
            &TimelinePageRequest {
                request_id: 44,
                year: Some(2026),
                kind: None,
                search_query: "completed".to_string(),
                offset: 0,
                limit: 2,
                anchor_date: None,
            },
        )
        .unwrap()
        .value;

        assert_eq!(page.request_id, 44);
        assert_eq!(page.total_count, 2);
        assert_eq!(page.all_event_count, 4);
        assert_eq!(page.events.len(), 2);
        assert!(!page.has_more);
        assert_eq!(page.available_years, vec![2026, 2025]);
        assert_eq!(page.summary.total_minutes, 90);
        assert_eq!(page.summary.completed_titles, 1);
        let json = serde_json::to_string(&page).unwrap();
        assert!(!json.contains("large notes"));
        assert!(!json.contains("description must not"));
    }

    #[test]
    fn dominant_activity_ties_use_the_newest_log_by_date_then_id() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("timeline-tie-test")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Mixed", "Ongoing")).unwrap();

        // Both activity types have the same count and latest date. The
        // Watching log on that date has the newer id, even though Reading has
        // the largest id overall because an older log was inserted last.
        for (date, activity_type) in [
            ("2026-02-01", "Reading"),
            ("2026-01-01", "Watching"),
            ("2026-02-01", "Watching"),
            ("2026-01-01", "Reading"),
        ] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 10,
                    characters: 0,
                    date: date.to_string(),
                    activity_type: activity_type.to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let events = get_all_timeline_events(&conn).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].activity_type, "Watching");
    }

    fn media_with_cover(title: &str, tracking_status: &str, cover_image: &str) -> Media {
        Media {
            cover_image: cover_image.to_string(),
            ..media(title, tracking_status)
        }
    }

    fn page_request(anchor_date: Option<&str>, offset: i64) -> TimelinePageRequest {
        TimelinePageRequest {
            request_id: 1,
            year: None,
            kind: None,
            search_query: String::new(),
            offset,
            limit: MAX_TIMELINE_PAGE_SIZE,
            anchor_date: anchor_date.map(str::to_string),
        }
    }

    fn bucket_request(
        granularity: TimelineBucketGranularity,
        year: Option<i32>,
        search_query: &str,
    ) -> TimelineBucketRequest {
        TimelineBucketRequest {
            request_id: 1,
            granularity,
            year,
            search_query: search_query.to_string(),
        }
    }

    fn seed_three_dated_events(name: &str) -> (tempfile::TempDir, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some(name)).unwrap();
        for (title, date) in [
            ("Alpha", "2026-01-10"),
            ("Beta", "2026-02-15"),
            ("Gamma", "2026-03-20"),
        ] {
            let media_id = db::add_media_with_id(&conn, &media(title, "Ongoing")).unwrap();
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 10,
                    characters: 0,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }
        (directory, conn)
    }

    #[test]
    fn anchor_seek_lands_on_exact_event_date() {
        let (_directory, conn) = seed_three_dated_events("anchor-exact");
        let page = get_timeline_page(&conn, &page_request(Some("2026-02-15"), 0))
            .unwrap()
            .value;
        assert_eq!(page.offset, 1);
        assert_eq!(page.events[0].media_title, "Beta");
    }

    #[test]
    fn anchor_seek_between_dates_lands_on_next_older_event() {
        let (_directory, conn) = seed_three_dated_events("anchor-between");
        let page = get_timeline_page(&conn, &page_request(Some("2026-03-01"), 0))
            .unwrap()
            .value;
        assert_eq!(page.offset, 1);
        assert_eq!(page.events[0].media_title, "Beta");
    }

    #[test]
    fn anchor_seek_newer_than_everything_returns_offset_zero() {
        let (_directory, conn) = seed_three_dated_events("anchor-newer");
        let page = get_timeline_page(&conn, &page_request(Some("2026-04-01"), 0))
            .unwrap()
            .value;
        assert_eq!(page.offset, 0);
        assert_eq!(page.events[0].media_title, "Gamma");
    }

    #[test]
    fn anchor_seek_older_than_everything_returns_empty_page_at_total_count() {
        let (_directory, conn) = seed_three_dated_events("anchor-older");
        let page = get_timeline_page(&conn, &page_request(Some("2020-01-01"), 0))
            .unwrap()
            .value;
        assert_eq!(page.offset, page.total_count);
        assert!(page.events.is_empty());
    }

    #[test]
    fn anchor_seek_overrides_nonzero_offset() {
        let (_directory, conn) = seed_three_dated_events("anchor-overrides-offset");
        let page = get_timeline_page(&conn, &page_request(Some("2026-03-20"), 2))
            .unwrap()
            .value;
        assert_eq!(page.offset, 0);
        assert_eq!(page.events[0].media_title, "Gamma");
    }

    #[test]
    fn folds_month_and_year_buckets_and_year_equals_sum_of_months() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-fold")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Novel", "Complete")).unwrap();
        for (date, minutes, characters) in
            [("2026-01-05", 20, 100), ("2026-02-10", 10, 50)]
        {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let months = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(months.buckets.len(), 2);
        assert_eq!(months.buckets[0].key, "2026-02");
        assert_eq!(months.buckets[0].finished_count, 1);
        assert_eq!(months.buckets[0].logged_minutes, 10);
        assert_eq!(months.buckets[0].logged_characters, 50);
        assert_eq!(months.buckets[1].key, "2026-01");
        assert_eq!(months.buckets[1].started_count, 1);
        assert_eq!(months.buckets[1].logged_minutes, 20);
        assert_eq!(months.buckets[1].logged_characters, 100);

        let years = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Year, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(years.buckets.len(), 1);
        let year_bucket = &years.buckets[0];
        assert_eq!(year_bucket.key, "2026");
        assert_eq!(year_bucket.started_count, 1);
        assert_eq!(year_bucket.finished_count, 1);
        assert_eq!(
            year_bucket.logged_minutes,
            months.buckets[0].logged_minutes + months.buckets[1].logged_minutes
        );
        assert_eq!(
            year_bucket.logged_characters,
            months.buckets[0].logged_characters + months.buckets[1].logged_characters
        );
    }

    #[test]
    fn search_filter_narrows_pips_and_logged_minutes_consistently() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-search")).unwrap();
        let kept_id = db::add_media_with_id(&conn, &media("Keep Me", "Ongoing")).unwrap();
        let dropped_id = db::add_media_with_id(&conn, &media("Filtered Out", "Ongoing")).unwrap();
        for (media_id, date, minutes) in
            [(kept_id, "2026-01-05", 20), (dropped_id, "2026-01-06", 15)]
        {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, "Keep"),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 1);
        let bucket = &buckets.buckets[0];
        assert_eq!(bucket.key, "2026-01");
        assert_eq!(bucket.started_count, 1);
        assert_eq!(bucket.logged_minutes, 20);
    }

    #[test]
    fn time_only_bucket_appears_without_a_lifecycle_event() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-time-only")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Long Read", "Ongoing")).unwrap();
        for (date, minutes) in [("2023-12-05", 5), ("2024-03-10", 25)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 2);
        let march = buckets
            .buckets
            .iter()
            .find(|bucket| bucket.key == "2024-03")
            .unwrap();
        assert_eq!(march.started_count, 0);
        assert_eq!(march.logged_minutes, 25);
    }

    #[test]
    fn year_filter_clips_bucket_keys_not_the_media_set() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-year-clip")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Long Read", "Ongoing")).unwrap();
        for (date, minutes) in [("2023-12-05", 5), ("2024-03-10", 25)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, Some(2024), ""),
        )
        .unwrap()
        .value;

        assert_eq!(buckets.buckets.len(), 1);
        let march = &buckets.buckets[0];
        assert_eq!(march.key, "2024-03");
        assert_eq!(march.started_count, 0);
        assert_eq!(march.logged_minutes, 25);
    }

    #[test]
    fn highlights_are_capped_with_overflow_count() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-highlights")).unwrap();
        for index in 1..=8 {
            let title = format!("Title {index}");
            let cover = format!("cover-{index}.png");
            let media_id =
                db::add_media_with_id(&conn, &media_with_cover(&title, "Ongoing", &cover))
                    .unwrap();
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 5,
                    characters: 0,
                    date: format!("2026-05-{index:02}"),
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 1);
        let bucket = &buckets.buckets[0];
        assert_eq!(bucket.started_count, 8);
        assert_eq!(bucket.highlights.len(), MAX_TIMELINE_BUCKET_HIGHLIGHTS);
        assert_eq!(bucket.highlight_overflow, 2);
    }

    #[test]
    fn milestones_are_capped_with_overflow_count() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-milestones")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Milestone Media", "Ongoing")).unwrap();
        let media_uid = db::get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|item| item.id == Some(media_id))
            .unwrap()
            .uid;
        for index in 1..=5 {
            db::add_milestone(
                &conn,
                &Milestone {
                    id: None,
                    media_uid: media_uid.clone(),
                    media_title: String::new(),
                    name: format!("Checkpoint {index}"),
                    duration: 10,
                    characters: 0,
                    date: Some(format!("2026-06-{index:02}")),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 1);
        let bucket = &buckets.buckets[0];
        assert_eq!(bucket.milestone_count, 5);
        assert_eq!(bucket.milestones.len(), MAX_TIMELINE_BUCKET_MILESTONES);
        assert_eq!(bucket.milestone_overflow, 1);
    }

    #[test]
    fn empty_database_returns_empty_buckets() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-empty")).unwrap();

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;

        assert!(buckets.buckets.is_empty());
        assert!(buckets.available_years.is_empty());
        assert!(buckets.ambiguous_titles.is_empty());
        assert_eq!(buckets.summary.total_minutes, 0);
        assert_eq!(buckets.summary.completed_titles, 0);
        assert_eq!(buckets.summary.total_characters, 0);
    }
}
