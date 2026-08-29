import { SessionLoader } from '@/components/SessionLoader';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionLoader id={id} />;
}
