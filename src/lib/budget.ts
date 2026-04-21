import type { Marketplace, RequestsByPlatform } from "@/lib/types";

type ReserveKind = Marketplace | "images";

export class RequestBudget {
  private readonly cap: number;
  private used = 0;
  private readonly requests: RequestsByPlatform = {
    amazon: 0,
    ebay: 0,
    images: 0,
    total: 0,
  };

  constructor(cap: number) {
    this.cap = cap;
  }

  reserve(kind: ReserveKind, count = 1) {
    if (count <= 0) {
      return true;
    }

    if (this.used + count > this.cap) {
      return false;
    }

    this.used += count;
    this.requests[kind] += count;
    this.requests.total += count;
    return true;
  }

  snapshot() {
    return {
      used: this.used,
      remaining: Math.max(this.cap - this.used, 0),
      cap: this.cap,
      requests: { ...this.requests },
    };
  }
}
