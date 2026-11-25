export abstract class BaseReport<Params, Data, Aggregated, Result> {
  async generate(params: Params): Promise<Result> {
    const data = await this.fetchData(params);
    return this.format(this.aggregate(data));
  }

  protected abstract fetchData(params: Params): Promise<Data>;
  protected abstract aggregate(data: Data): Aggregated;
  protected abstract format(data: Aggregated): Result;
}
