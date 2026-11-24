import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Inventory Workspace',
  description: 'Stock, lots, and warehouse movements in one workspace.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en-CA"><body>{children}</body></html>;
}
