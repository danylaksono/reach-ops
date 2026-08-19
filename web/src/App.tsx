import { MapViewProvider } from "./components/map-context";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <MapViewProvider>
        <AppShell />
      </MapViewProvider>
    </ErrorBoundary>
  );
}
