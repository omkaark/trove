import React from "react";
import "./ErrorBoundary.css";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  stack?: string;
  componentStack?: string;
}

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: "",
    stack: undefined,
    componentStack: undefined,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message, stack: error.stack };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Unexpected error:", error, errorInfo);
    if (errorInfo.componentStack) {
      this.setState({ componentStack: errorInfo.componentStack });
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      message: "",
      stack: undefined,
      componentStack: undefined,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h2>Something went wrong</h2>
            <p>{this.state.message || "Please reload the app."}</p>
            {import.meta.env.DEV && (this.state.stack || this.state.componentStack) && (
              <pre className="error-boundary-stack">
                {this.state.stack}
                {this.state.componentStack
                  ? `\n\nComponent stack:\n${this.state.componentStack.trim()}`
                  : ""}
              </pre>
            )}
            <div className="error-boundary-actions">
              <button onClick={this.handleReset}>Try again</button>
              <button onClick={this.handleReload}>Reload</button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
