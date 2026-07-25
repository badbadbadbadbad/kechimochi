import { describe, it, expect, vi } from 'vitest';
import { Component } from '../../src/component';

class TestComponent extends Component<{ count: number }> {
    render = vi.fn();
}

class TestComponentHarness extends TestComponent {
    public declare container: TestComponent['container'];
    public declare state: TestComponent['state'];

    public override clear(): void {
        super.clear();
    }
}

describe('core/component.ts', () => {
    it('constructor should initialize state and container', () => {
        const container = document.createElement('div');
        const component = new TestComponentHarness(container, { count: 0 });
        expect(component.container).toBe(container);
        expect(component.state).toEqual({ count: 0 });
    });

    it('setState should update state and call render', () => {
        const container = document.createElement('div');
        const component = new TestComponentHarness(container, { count: 0 });
        component.setState({ count: 1 });
        expect(component.state).toEqual({ count: 1 });
        expect(component.render).toHaveBeenCalled();
    });

    it('clear should remove all children from container', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>1</span><span>2</span>';
        const component = new TestComponentHarness(container, { count: 0 });
        component.clear();
        expect(container.children).toHaveLength(0);
        expect(container.innerHTML).toBe('');
    });
});
