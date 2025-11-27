export interface AnalyticsContext {
  title: string;
  queryFile: string;
  queryLabel: string;
  sshTarget: string;
  dbPath: string;
  fromDate?: string;
}

export interface AnalyticsSpec<RowType = Record<string, unknown>> {
  flag: string;
  description: string;
  sqlPath: string;
  sqlDisplayName: string;
  defaultTitle: string;
  transform(rows: Record<string, unknown>[]): RowType[];
  filterRows?(rows: RowType[], ctx: AnalyticsContext): RowType[];
  buildJson(rows: RowType[], ctx: AnalyticsContext): unknown;
  buildHtml(rows: RowType[], ctx: AnalyticsContext): string;
  buildEmptyJson?(ctx: AnalyticsContext): unknown;
  buildEmptyHtml?(ctx: AnalyticsContext): string;
}