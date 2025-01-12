import { inchAdapter, InchAdapter } from "./inch";
import { tsbsAdapter, TSBSAdapter } from "./tsbs";
import { goAdapter, GoAdapter } from "./go";
import { artilleryAdapter, ArtilleryAdapter } from "./artillery";
import { puppeteerAdapter, PuppeteerAdapter } from "./frontend-benchmark";
import { Config } from "../config";
import { BenchmarkAdapter } from "../types";
import { z } from "zod";
import { httpAdapter, HttpAdapter } from "./http";

type IfEquals<X, Y, A = X, B = never> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? A
  : B;

type NullAdapter = BenchmarkAdapter<"null", z.AnyZodObject>;

export type Adapter<T extends Config["benchmark"]["tool"]> = IfEquals<
  T,
  InchAdapter["tool"],
  InchAdapter,
  IfEquals<
    T,
    GoAdapter["tool"],
    GoAdapter,
    IfEquals<
      T,
      TSBSAdapter["tool"],
      TSBSAdapter,
      IfEquals<
        T,
        ArtilleryAdapter["tool"],
        ArtilleryAdapter,
        IfEquals<
          T,
          PuppeteerAdapter["tool"],
          PuppeteerAdapter,
          IfEquals<T, HttpAdapter["tool"], HttpAdapter, NullAdapter>
        >
      >
    >
  >
>;

export const adapters = [
  inchAdapter,
  tsbsAdapter,
  goAdapter,
  artilleryAdapter,
  puppeteerAdapter,
  httpAdapter,
] as const;
