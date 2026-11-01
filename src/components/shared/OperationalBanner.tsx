export interface OperationalBannerMetric {
  label: string;
  value: string | number;
  valueClassName?: string;
}
interface OperationalBannerProps {
  id: string;
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  metrics: OperationalBannerMetric[];
  isConnected?: boolean;
}

/** Compatibility boundary: keep the accessible screen heading, without a summary UI or registry. */
export function OperationalBanner({ id, title }: OperationalBannerProps) {
  return <h1 id={id} className="sr-only">{title}</h1>;
}
