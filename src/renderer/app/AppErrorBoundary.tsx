import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('NovelReaper shell render failure', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="fatal-shell" role="alert">
        <p className="eyebrow">NovelReaper</p>
        <h1>The application shell hit an unexpected error.</h1>
        <p>Your books have not been changed. Reload the local interface to continue.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload interface
        </button>
      </main>
    );
  }
}
