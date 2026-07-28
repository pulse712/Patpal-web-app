import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type DayPoint = {
  date: string;
  count: number;
};

const chartConfig = {
  sessions: {
    label: "Sessions",
    color: "oklch(0.68 0.11 187)",
  },
} satisfies ChartConfig;

function formatDayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AdminSessionsChart({ data }: { data: DayPoint[] }) {
  const chartData = data.map(({ date, count }) => ({
    date,
    label: formatDayLabel(date),
    sessions: count,
  }));
  const total = data.reduce((sum, day) => sum + day.count, 0);
  const peak = Math.max(...data.map((day) => day.count), 0);

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sessions — last 14 days
          </p>
          <p className="mt-1 text-2xl font-bold">{total}</p>
          <p className="text-xs text-muted-foreground">ended sessions in period</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Peak day</p>
          <p className="text-sm font-semibold">{peak} sessions</p>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
        <BarChart data={chartData} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 10 }}
            angle={-35}
            textAnchor="end"
            height={56}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip
            cursor={{ fill: "oklch(0.68 0.11 187 / 0.08)" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { date?: string } | undefined;
                  return row?.date
                    ? new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : "";
                }}
              />
            }
          />
          <Bar dataKey="sessions" fill="var(--color-sessions)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
