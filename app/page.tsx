import Workspace from './workspace';
import AuthGate from './auth';

export default function Page() {
  return <AuthGate><Workspace /></AuthGate>;
}
