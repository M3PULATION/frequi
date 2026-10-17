import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type MetricItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
};

export function MetricList({ title, description, items }: { title: string; description?: string; items: MetricItem[] }) {
  return (
    <Card data-testid="metric-list">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.label}>
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className={`font-mono text-sm ${item.tone ?? ''}`}>{item.value}</dd>
              {item.hint ? <p className="text-xs text-muted-foreground">{item.hint}</p> : null}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
