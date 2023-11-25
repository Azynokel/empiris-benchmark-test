import { parseOutput } from '../inch';

describe('parseOutput', () => {
  it('should parse the output and return the correct metrics', () => {
    const output = `Some random output without metrics\nT=00000004 1150000 points written (11%). Total throughput: 287454.9 pt/sec | 287454.9 val/sec. Current throughput: 310000 val/sec. Errors: 0 | μ: 257.168947ms, 90%: 366.936588ms, 95%: 376.248063ms, 99%: 423.960031ms\nT=00000005 1430000 points written (14%). Total throughput: 285981.5 pt/sec | 285981.5 val/sec. Current throughput: 280000 val/sec. Errors: 2 | μ: 267.777865ms, 90%: 376.248063ms, 95%: 436.505871ms, 99%: 561.049455ms`;

    const metrics = parseOutput(output);

    expect(metrics).toEqual([
      { type: 'dataframe', metric: 'throughput', value: 287454.9, unit: 'pt/sec', specifier: 'total' },
      { type: 'dataframe', metric: 'throughput', value: 310000, unit: 'val/sec', specifier: 'current' },
      { type: 'dataframe', metric: 'error_rate', value: 0, unit: 'errors', specifier: null },
      { type: 'dataframe', metric: 'latency', value: 257.168947, unit: 'ms', specifier: 'μ' },
      { type: 'dataframe', metric: 'latency', value: 366.936588, unit: 'ms', specifier: '90%' },
      { type: 'dataframe', metric: 'latency', value: 376.248063, unit: 'ms', specifier: '95%' },
      { type: 'dataframe', metric: 'latency', value: 423.960031, unit: 'ms', specifier: '99%' },
      /*--------------------------- new line ---------------------------*/
      { type: 'dataframe', metric: 'throughput', value: 285981.5, unit: 'pt/sec', specifier: 'total' },
      { type: 'dataframe', metric: 'throughput', value: 280000, unit: 'val/sec', specifier: 'current' },
      { type: 'dataframe', metric: 'error_rate', value: 2, unit: 'errors', specifier: null },
      { type: 'dataframe', metric: 'latency', value: 267.777865, unit: 'ms', specifier: 'μ' },
      { type: 'dataframe', metric: 'latency', value: 376.248063, unit: 'ms', specifier: '90%' },
      { type: 'dataframe', metric: 'latency', value: 436.505871, unit: 'ms', specifier: '95%' },
      { type: 'dataframe', metric: 'latency', value: 561.049455, unit: 'ms', specifier: '99%' },
    ]);
  });

  it('should return empty array if no metrics are found in the output', () => {
    const output = `Some random output without metrics`;

    const metrics = parseOutput(output);

    expect(metrics).toEqual([]);
  });
});