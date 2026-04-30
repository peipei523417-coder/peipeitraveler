import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Catches render errors inside the project detail page so a malformed
 * itinerary / shared project payload does not bring down the whole app.
 */
export class ProjectErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ProjectDetail] render error reason", { error, info });
  }

  handleBack = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
          <p className="text-lg font-semibold text-foreground mb-2">
            專案載入失敗
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            請返回大廳後再試一次
          </p>
          <Button onClick={this.handleBack} className="rounded-xl">
            返回大廳
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
