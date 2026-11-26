import Workspace from './workspace';
import AuthGate from './auth';
import { AppearanceProvider } from './appearance-provider';

export default function Page() {
  return <AppearanceProvider><AuthGate><Workspace /></AuthGate></AppearanceProvider>;
}
