import { Trans } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Tooltip, Treemap, type TreemapNode } from "recharts";
import { HeatLegend } from "@/components/analysis/primitives";
import { AssetClassLabel } from "@/components/asset-labels";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import {
  formatMoney,
  formatSignedPercentPrecise,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { heatTint } from "@/lib/heat";
import {
  DAILY_HEAT_CAP,
  type DailyData,
  type DailyPosition,
  marketPositions,
  signedOrZero,
} from "./types";

type Tile = {
  name: string;
  size: number;
  percent: number | null;
  position: DailyPosition;
};

/**
 * Treemap of the open book: area is the position's value, color is the
 * day's move. The asset table below carries the same numbers in text.
 */
export function MarketMap({
  data,
  className,
}: {
  data: DailyData;
  className?: string;
}) {
  const navigate = useNavigate();
  const tiles = useMemo<Tile[]>(
    () =>
      marketPositions(data)
        .map((position) => ({
          name: position.ticker,
          size: Number(position.convertedMarketValue),
          percent:
            position.dailyChangePercent == null
              ? null
              : Number(position.dailyChangePercent),
          position,
        }))
        .sort((a, b) => b.size - a.size),
    [data],
  );
  const byTicker = useMemo(
    () => new Map(tiles.map((tile) => [tile.name, tile])),
    [tiles],
  );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1.5">
          <CardTitle>
            <Trans id="daily.mapTitle">Market map</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="daily.mapHint">
              Each tile is a holding sized by its value and colored by today's
              move. Select one to open the asset.
            </Trans>
          </CardDescription>
        </div>
        <div className="shrink-0 hidden sm:block">
          <HeatLegend cap={DAILY_HEAT_CAP} />
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {tiles.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Trans id="daily.mapEmpty">No quoted holdings to map yet.</Trans>
          </p>
        ) : (
          <ChartContainer
            config={{}}
            className="aspect-auto h-[300px] w-full lg:h-full lg:min-h-[340px]"
          >
            <Treemap
              data={tiles}
              dataKey="size"
              nameKey="name"
              aspectRatio={4 / 3}
              isAnimationActive={false}
              onClick={(node) => {
                if (byTicker.has(node.name)) {
                  void navigate({
                    to: "/assets/$ticker",
                    params: { ticker: node.name },
                  });
                }
              }}
              content={(node: TreemapNode) => (
                <MapTile node={node} tile={byTicker.get(node.name)} />
              )}
            >
              <Tooltip
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const name = (
                    payload?.[0]?.payload as TreemapNode | undefined
                  )?.name;
                  const tile = name ? byTicker.get(name) : undefined;

                  return active && tile ? <TileTooltip tile={tile} /> : null;
                }}
              />
            </Treemap>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function MapTile({ node, tile }: { node: TreemapNode; tile?: Tile }) {
  if (!tile || node.depth !== 1) {
    return <g />;
  }

  const { x, y, width, height } = node;
  const showName = width >= 44 && height >= 28;
  const showPercent = showName && height >= 44 && tile.percent != null;
  const large = width >= 120 && height >= 80;
  const nameSize = large ? 15 : 12;
  const centerY = y + height / 2;

  return (
    <g className="cursor-pointer">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        style={{
          fill:
            heatTint(tile.percent, DAILY_HEAT_CAP, "var(--muted)") ??
            "var(--muted)",
          stroke: "var(--card)",
          strokeWidth: 2,
        }}
      />
      {showName ? (
        <text
          x={x + width / 2}
          y={showPercent ? centerY - (large ? 4 : 2) : centerY + 4}
          textAnchor="middle"
          style={{
            fill: "var(--foreground)",
            fontSize: nameSize,
            fontWeight: 600,
          }}
        >
          {tile.name}
        </text>
      ) : null}
      {showPercent && tile.percent != null ? (
        <text
          x={x + width / 2}
          y={centerY + (large ? 16 : 13)}
          textAnchor="middle"
          style={{
            fill: "var(--foreground)",
            fontSize: large ? 13 : 11,
            opacity: 0.85,
          }}
        >
          {formatSignedPercentPrecise(String(tile.percent))}
        </text>
      ) : null}
    </g>
  );
}

function TileTooltip({ tile }: { tile: Tile }) {
  const { position } = tile;

  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{position.ticker}</span>
        <span className="text-muted-foreground">
          <AssetClassLabel assetClass={position.assetClass} />
        </span>
      </div>
      <TooltipLine
        label={<Trans id="daily.colDayChange">Day change</Trans>}
        value={
          position.dailyChange == null
            ? "—"
            : signedOrZero(position.dailyChange, position.displayCurrency)
        }
        valueClassName={
          position.dailyChange == null
            ? undefined
            : pnlClassName(position.dailyChange)
        }
        extra={
          position.dailyChangePercent
            ? formatSignedPercentPrecise(position.dailyChangePercent)
            : undefined
        }
      />
      <TooltipLine
        label={<Trans id="daily.colMarketValue">Market value</Trans>}
        value={formatMoney(
          position.convertedMarketValue ?? "0",
          position.displayCurrency,
        )}
        extra={position.weight ? formatWeight(position.weight) : undefined}
      />
    </div>
  );
}

function TooltipLine({
  label,
  value,
  valueClassName,
  extra,
}: {
  label: React.ReactNode;
  value: string;
  valueClassName?: string;
  extra?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`ml-auto font-medium tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </span>
      {extra ? (
        <span className="w-14 text-right text-muted-foreground tabular-nums">
          {extra}
        </span>
      ) : null}
    </div>
  );
}
