import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Defense-in-depth around the wasm engine: a compute call that throws
 *  (a Rust panic surfaces as a JS exception, not a rejected promise) would
 *  otherwise unmount the entire tree with no on-screen explanation. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Reach-Ops crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ground px-6 text-center">
          <div className="font-display text-[15px] font-bold text-status-broken">
            The dashboard hit an unrecoverable error
          </div>
          <div className="max-w-md font-mono text-[11.5px] text-ink-muted">{this.state.error.message}</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-sm border border-line bg-panel-raised px-3 py-1.5 text-[12px] text-ink hover:bg-line"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
