import { loadPyodide } from "pyodide";

export async function wilcoxonTest(sample1: number[], sample2: number[]) {
  const pyodide = await loadPyodide({});
  await pyodide.loadPackage(["numpy", "pandas", "scipy"]);
  const globals = pyodide.toPy({
    sample1,
    sample2,
  });
  const p = await pyodide.runPython(
    `
import numpy as np
import pandas as pd
import scipy.stats as stats

# Wilcoxon signed-rank test
stat, p = stats.wilcoxon(sample1, sample2)
stat, p
`,
    { globals }
  );

  const result = p.toJs() as [number, number];

  return {
    stat: result[0],
    p: parseFloat(result[1].toFixed(5)),
    significant: result[1] < 0.05,
  };
}

export async function bootrapping(sample1: number[], sample2: number[]) {
  const pyodide = await loadPyodide({});
  await pyodide.loadPackage(["numpy", "pandas", "scipy"]);
  const globals = pyodide.toPy({
    sample1,
    sample2,
  });

  const p = await pyodide.runPython(
    `
import pandas as pd

def confidence_interval(data, confidence=0.99):
    """Calculate the confidence interval using bootstrapping for the median"""
    n = len(data)
    medians = []
    for _ in range(1000):
        sample = data.sample(n, replace=True)
        medians.append(sample.median())

    return pd.Series(medians).quantile((1 - confidence) / 2), pd.Series(medians).quantile(1 - (1 - confidence) / 2)

def is_performance_change_with_confidence_interval(old_wall_time: pd.Series, new_wall_time: pd.Series) -> bool:
    # Calculate the confidence interval for the median
    # ratio between the old and new wallTime
    diff = new_wall_time / old_wall_time
    # Calculate the confidence interval for the median
    lower, upper = confidence_interval(diff)
    ci_mean = diff.mean()
    # If the confidence interval does not contain 1, there is a significant difference
    return lower > 1 or upper < 1, lower, upper, ci_mean

is_performance_change_with_confidence_interval(pd.Series(sample1), pd.Series(sample2))
`, { globals });

  const [significant, ci_lower, ci_upper, ci_mean] = p.toJs() as [boolean, number, number, number];

  return {
    significant,
    ci_lower,
    ci_upper,
    ci_mean,
  };
}