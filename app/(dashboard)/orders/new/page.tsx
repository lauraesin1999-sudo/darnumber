"use client";

import { useEffect, useState, useMemo, useDeferredValue } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// Removed Radix Select in favor of virtualized Dialog lists
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  AlertCircle,
  CheckCircle2,
  Wallet,
  ChevronRight,
} from "lucide-react";
import { FixedSizeList as List } from "react-window";
import type { ListChildComponentProps } from "react-window";

interface Provider {
  id: string;
  name: string;
  displayName: string;
  cover: string;
  logo?: ReactNode | string;
}

interface ServiceUi {
  displayName?: string;
  color?: string;
  logo?: ReactNode | string;
}

/** Unique service from the lightweight catalog (no country expansion). */
interface Service {
  code: string;
  name: string;
  providers: Array<{ id: string; name: string; displayName: string }>;
  ui?: ServiceUi;
  capability?: string;
}

interface CountryOption {
  code: string;
  name: string;
  priceUsd: number;
  priceNgn: number;
}

const FALLBACK_USD_TO_NGN = 1600;

export default function NewOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  /** Unique services catalog (not the old full service×country matrix). */
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedService, setSelectedService] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [error, setError] = useState("");
  const [balance, setBalance] = useState(0);
  const [serviceSearch, setServiceSearch] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [countryDialogOpen, setCountryDialogOpen] = useState(false);
  const [countryNameByCode, setCountryNameByCode] = useState<
    Map<string, string>
  >(new Map());
  const [usdToNgn, setUsdToNgn] = useState<number>(FALLBACK_USD_TO_NGN);
  const [tvExactPriceUsd, setTvExactPriceUsd] = useState<number | null>(null);
  const [tvPriceLoading, setTvPriceLoading] = useState(false);
  /** Countries for the currently selected service+provider (loaded on demand). */
  const [serviceCountries, setServiceCountries] = useState<CountryOption[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);

  const deferredServiceSearch = useDeferredValue(serviceSearch);
  const deferredCountrySearch = useDeferredValue(countrySearch);

  // Fetch countries from SMS-Man API and map code -> full name
  useEffect(() => {
    const loadCountries = async () => {
      try {
        const map = new Map<string, string>();
        // Prefer server-proxied list (supports server env secret)
        try {
          const res = await fetch("/api/providers/smsman/countries");
          if (res.ok) {
            const out = await res.json();
            const countries = out?.data?.countries || {};
            Object.entries(countries).forEach(([code, title]) => {
              if (code && title)
                map.set(String(code).toUpperCase(), String(title));
            });
          }
        } catch (_) {
          // ignore and fallback
        }

        // Fallback to static country list if API/token unavailable
        if (map.size === 0) {
          try {
            const mod = await import("@/lib/constants/countries");
            const list = mod.getCountryList?.() || [];
            list.forEach((c: any) => {
              if (c?.code && c?.name) {
                map.set(String(c.code).toUpperCase(), c.name);
              }
            });
          } catch (_) {
            // ignore
          }
        }

        setCountryNameByCode(map);
      } catch (e) {
        console.error("[NewOrderPage] Failed to fetch countries list:", e);
        // Try fallback to static country list
        try {
          const mod = await import("@/lib/constants/countries");
          const list = mod.getCountryList?.() || [];
          const map = new Map<string, string>();
          list.forEach((c: any) => {
            if (c?.code && c?.name) {
              map.set(String(c.code).toUpperCase(), c.name);
            }
          });
          setCountryNameByCode(map);
        } catch (_) {
          // Leave map empty; UI will fall back to service.country
        }
      }
    };
    loadCountries();
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // Exchange rate is now loaded from the services API in fetchData().
  // Fallback: fetch from our own server API if services didn't include it.
  useEffect(() => {
    const loadFallbackRate = async () => {
      // Only fetch if still using the hardcoded fallback
      if (usdToNgn !== FALLBACK_USD_TO_NGN) return;
      try {
        console.log("[NewOrderPage] Fetching exchange rate from server API...");
        const res = await fetch("/api/exchange-rates");
        if (res.ok) {
          const data = await res.json();
          const rate = data?.data?.usdToNgn;
          if (rate && rate > 0) {
            console.log(
              `[NewOrderPage] Exchange rate from API: 1 USD = ₦${rate}`,
            );
            setUsdToNgn(rate);
          }
        }
      } catch (e) {
        console.warn(
          "[NewOrderPage] Failed to fetch exchange rate fallback:",
          e,
        );
      }
    };
    // Delay slightly to let fetchData set the rate first
    const timer = setTimeout(loadFallbackRate, 2000);
    return () => clearTimeout(timer);
  }, [usdToNgn]);

  const fetchData = async () => {
    try {
      console.log("[NewOrderPage] ========== FETCHING LIGHTWEIGHT CATALOG ==========");

      const fetchCatalogWithRetry = async () => {
        try {
          return await api.getAvailableServices();
        } catch (firstError) {
          console.warn(
            "[NewOrderPage] Catalog API first attempt failed, retrying once...",
            firstError,
          );
          await new Promise((resolve) => setTimeout(resolve, 700));
          return await api.getAvailableServices();
        }
      };

      // Catalog + balance independently so one failure doesn't block the other
      let servicesRes: any = null;
      let balanceRes: any = null;
      let servicesError: any = null;

      const [sResult, bResult] = await Promise.allSettled([
        fetchCatalogWithRetry(),
        api.getBalance(),
      ]);

      if (sResult.status === "fulfilled") {
        servicesRes = sResult.value;
      } else {
        servicesError = sResult.reason;
        console.warn("[NewOrderPage] Catalog API failed:", {
          message: servicesError?.message || String(servicesError),
          status: servicesError?.response?.status,
          data: servicesError?.response?.data,
        });
      }

      if (bResult.status === "fulfilled") {
        balanceRes = bResult.value;
        setBalance(balanceRes.data.balance);
      } else {
        console.warn(
          "[NewOrderPage] Balance API failed:",
          bResult.reason?.message,
        );
      }

      const defaultProviders: Provider[] = [
        {
          id: "lion",
          name: "sms-man",
          displayName: "Lion SMS",
          cover: "All Countries",
        },
        {
          id: "panda",
          name: "textverified",
          displayName: "Panda Verify",
          cover: "United States",
        },
      ];

      if (servicesRes) {
        const services: Service[] = servicesRes?.data?.services || [];
        const providersFromApi: Provider[] = servicesRes?.data?.providers || [];

        const apiRate = servicesRes?.data?.exchangeRate?.usdToNgn;
        if (apiRate && typeof apiRate === "number" && apiRate > 0) {
          console.log(
            `[NewOrderPage] Exchange rate from catalog: 1 USD = ₦${apiRate}`,
          );
          setUsdToNgn(apiRate);
        }

        console.log(
          `[NewOrderPage] Loaded lightweight catalog: ${services.length} unique services, ${providersFromApi.length} providers`,
        );

        setAllServices(services);
        setProviders(
          providersFromApi.length > 0 ? providersFromApi : defaultProviders,
        );
      } else {
        setProviders(defaultProviders);
        const statusCode = servicesError?.response?.status;
        if (statusCode === 401) {
          setError("Session expired. Please log in again.");
        } else if (statusCode === 503) {
          setError(
            "Provider services are temporarily unavailable. Please try again in a moment.",
          );
        } else {
          setError("Failed to load services. Please refresh the page.");
        }
      }

      if (!selectedProvider) {
        setSelectedProvider("lion");
      }
    } catch (error: any) {
      console.error("[NewOrderPage] Unexpected error in fetchData:", error);
      setProviders([
        {
          id: "lion",
          name: "sms-man",
          displayName: "Lion SMS",
          cover: "All Countries",
        },
        {
          id: "panda",
          name: "textverified",
          displayName: "Panda Verify",
          cover: "United States",
        },
      ]);
      if (!selectedProvider) setSelectedProvider("lion");
      setError("Failed to load services. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  };

  // Unique services for the selected provider (catalog is already unique by code)
  const availableServices = useMemo(() => {
    if (!selectedProvider || !allServices.length) return [];
    return allServices.filter((service) =>
      service.providers.some((p) => p.id === selectedProvider),
    );
  }, [allServices, selectedProvider]);

  // Countries come from the on-demand endpoint (already priced),
  // enriched with full names when the country map loads.
  const availableCountries = useMemo(() => {
    return serviceCountries.map((c) => ({
      ...c,
      name: countryNameByCode.get(c.code) || c.name || c.code,
    }));
  }, [serviceCountries, countryNameByCode]);

  // Filter services based on search
  // Lightweight fuzzy search scoring
  const fuzzyScore = (text: string, query: string) => {
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    if (!q) return 0;
    if (t.includes(q)) return 100 - t.indexOf(q); // prefer early matches
    // subsequence match
    let ti = 0,
      qi = 0,
      score = 0;
    while (ti < t.length && qi < q.length) {
      if (t[ti] === q[qi]) {
        score += 5; // reward matched char
        qi++;
      }
      ti++;
    }
    // small bonus if all chars found
    if (qi === q.length) score += 20;
    return score;
  };

  const filteredServices = useMemo(() => {
    const query = deferredServiceSearch || "";
    if (!query) return availableServices;
    return [...availableServices]
      .map((service) => {
        const display = service.ui?.displayName || service.name || "";
        const s1 = fuzzyScore(display, query);
        const s2 = fuzzyScore(service.code || "", query);
        return { service, score: Math.max(s1, s2) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.service);
  }, [availableServices, deferredServiceSearch]);

  // Filter countries based on search
  const filteredCountries = useMemo(() => {
    const query = deferredCountrySearch || "";
    if (!query) return availableCountries;
    return [...availableCountries]
      .map((country) => {
        const s1 = fuzzyScore(country.name, query);
        const s2 = fuzzyScore(country.code, query);
        return { country, score: Math.max(s1, s2) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.country);
  }, [availableCountries, deferredCountrySearch]);

  // Reset selections when provider changes
  useEffect(() => {
    setSelectedService("");
    setSelectedCountry("");
    setServiceCountries([]);
    setTvExactPriceUsd(null);
  }, [selectedProvider]);

  // Reset country when service changes
  useEffect(() => {
    setSelectedCountry("");
  }, [selectedService]);

  // Progressive load: countries + prices for the selected service only
  useEffect(() => {
    let cancelled = false;

    if (!selectedService || !selectedProvider) {
      setServiceCountries([]);
      setCountriesLoading(false);
      return;
    }

    const loadCountries = async () => {
      try {
        setCountriesLoading(true);
        setServiceCountries([]);
        console.log(
          `[NewOrderPage] Loading countries for ${selectedService} / ${selectedProvider}...`,
        );
        const res = await api.getServiceCountries(
          selectedService,
          selectedProvider,
        );
        if (cancelled) return;

        const rate =
          res?.data?.exchangeRate?.usdToNgn &&
          res.data.exchangeRate.usdToNgn > 0
            ? res.data.exchangeRate.usdToNgn
            : usdToNgn || FALLBACK_USD_TO_NGN;

        if (
          res?.data?.exchangeRate?.usdToNgn &&
          res.data.exchangeRate.usdToNgn > 0
        ) {
          setUsdToNgn(res.data.exchangeRate.usdToNgn);
        }

        const countries: CountryOption[] = (res?.data?.countries || []).map(
          (c: { code: string; name: string; priceUsd: number }) => {
            const code = String(c.code || "").toUpperCase();
            const name =
              countryNameByCode.get(code) || c.name || code;
            const priceUsd = Number(c.priceUsd) || 0;
            return {
              code,
              name,
              priceUsd,
              priceNgn: Math.ceil(priceUsd * rate),
            };
          },
        );

        console.log(
          `[NewOrderPage] Loaded ${countries.length} countries for ${selectedService}`,
        );
        setServiceCountries(countries);
      } catch (e) {
        if (!cancelled) {
          console.warn("[NewOrderPage] Failed to load countries:", e);
          setServiceCountries([]);
          setError(
            "Failed to load countries for this service. Please try again.",
          );
        }
      } finally {
        if (!cancelled) setCountriesLoading(false);
      }
    };

    void loadCountries();
    return () => {
      cancelled = true;
    };
    // countryNameByCode is enrichment only; re-run when names arrive is optional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService, selectedProvider]);

  // Fetch exact TextVerified price only for the currently selected service.
  useEffect(() => {
    let cancelled = false;
    const isTextVerified = selectedProvider === "panda";

    if (!isTextVerified || !selectedService) {
      setTvExactPriceUsd(null);
      setTvPriceLoading(false);
      return;
    }

    const fetchTextVerifiedPrice = async () => {
      try {
        setTvPriceLoading(true);
        setTvExactPriceUsd(null);
        const res = await api.getTextVerifiedPrice(selectedService);
        if (cancelled) return;

        const exactUsd = res?.data?.finalUsd;
        if (typeof exactUsd === "number" && exactUsd > 0) {
          setTvExactPriceUsd(exactUsd);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn(
            `[NewOrderPage] Failed to fetch exact TextVerified price for ${selectedService}:`,
            e,
          );
        }
      } finally {
        if (!cancelled) setTvPriceLoading(false);
      }
    };

    void fetchTextVerifiedPrice();

    return () => {
      cancelled = true;
    };
  }, [selectedProvider, selectedService]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    console.log("[NewOrderPage] ========== SUBMIT ORDER ==========");
    console.log("[NewOrderPage] Selected:", {
      service: selectedService,
      country: selectedCountry,
      provider: selectedProvider,
    });

    if (!selectedService || !selectedCountry || !selectedProvider) {
      console.error("[NewOrderPage] Validation failed: missing selection");
      toast.api.validationError("Please select service, country, and provider");
      setError("Please select service, country, and provider");
      return;
    }

    const service = allServices.find(
      (s) =>
        s.code === selectedService &&
        s.providers.some((p) => p.id === selectedProvider),
    );

    if (!service) {
      console.error("[NewOrderPage] Service not found in catalog for:", {
        code: selectedService,
        provider: selectedProvider,
      });
      toast.error("Service not found", "Please try selecting again.");
      setError("Service not found");
      return;
    }

    const countryRow = serviceCountries.find(
      (c) => c.code === selectedCountry,
    );
    if (!countryRow && selectedProvider !== "panda") {
      toast.error("Country not found", "Please re-select the country.");
      setError("Country not found for this service");
      return;
    }

    if (balance < currentPriceNgn) {
      console.error("[NewOrderPage] Insufficient balance:", {
        balance,
        required: currentPriceNgn,
        deficit: currentPriceNgn - balance,
      });
      toast.payment.insufficientBalance();
      setError(
        `Insufficient balance. You need ₦${currentPriceNgn.toLocaleString()} but only have ₦${balance.toLocaleString()}. Please add ₦${(
          currentPriceNgn - balance
        ).toLocaleString()} to your wallet.`,
      );
      return;
    }

    setCreating(true);

    try {
      const provider = providers.find((p) => p.id === selectedProvider);
      const price = currentPriceNgn;

      console.log("[NewOrderPage] Order price calculation:", {
        countryPrice_USD: countryRow?.priceUsd,
        tvExactPriceUsd,
        exchangeRate_USD_NGN: usdToNgn,
        finalPrice_NGN: price,
        providerName: provider?.name,
      });

      if (!price || price <= 0) {
        console.error("[NewOrderPage] Price is 0 or invalid:", price);
        setError(
          "Could not determine the price for this service. Please try again.",
        );
        setCreating(false);
        return;
      }

      const response = await api.createOrder({
        serviceCode: selectedService,
        country: selectedCountry,
        provider: provider?.name,
        price: price, // NGN amount
      });

      if (response.ok) {
        toast.order.created(response.data.orderNumber);
        router.push(`/orders/${response.data.orderId}`);
      } else {
        toast.order.failed(response.error || "Failed to create order");
        setError(response.error || "Failed to create order");
      }
    } catch (err: unknown) {
      console.error("[NewOrderPage] Order creation exception:", err);
      let message = "Failed to create order. Please try again.";
      if (typeof err === "object" && err && "response" in err) {
        const e = err as {
          response?: { data?: { error?: { message: string } } };
        };
        message = e.response?.data?.error?.message || message;
      }
      toast.order.failed(message);
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
        <span className="ml-2">Loading services...</span>
      </div>
    );
  }

  const currentService = allServices.find(
    (s) =>
      s.code === selectedService &&
      s.providers.some((p) => p.id === selectedProvider),
  );
  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const currentCountry = serviceCountries.find(
    (c) => c.code === selectedCountry,
  );

  const aggregatedPriceUsd = currentCountry?.priceUsd ?? 0;
  const currentPriceUsd =
    selectedProvider === "panda" && tvExactPriceUsd !== null
      ? tvExactPriceUsd
      : aggregatedPriceUsd;
  const currentPriceNgn = Math.ceil(
    currentPriceUsd * (usdToNgn || FALLBACK_USD_TO_NGN),
  );
  const waitingForTvPrice =
    selectedProvider === "panda" && !!selectedService && tvPriceLoading;

  const insufficientBalance =
    !!selectedService &&
    !!selectedCountry &&
    currentPriceNgn > 0 &&
    balance < currentPriceNgn;

  // Virtualized row renderer for services list
  // Note: This is a render function, NOT a React component - do NOT use hooks inside it
  const renderServiceRow = ({ index, style }: ListChildComponentProps) => {
    const service = filteredServices[index];

    return (
      <div
        style={style}
        key={service.code}
        className="px-3 py-2 border-b last:border-b-0"
      >
        <button
          type="button"
          onClick={() => {
            setSelectedService(service.code);
            setServiceDialogOpen(false);
          }}
          className="w-full flex items-center gap-3 text-left hover:bg-accent rounded-md px-2 py-2"
        >
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs bg-gray-200">
            📱
          </div>
          <span className="font-medium truncate flex-1">
            {service.ui?.displayName || service.name}
          </span>
          <div className="flex-shrink-0 text-xs text-muted-foreground">✅</div>
        </button>
      </div>
    );
  };

  // Virtualized row renderer for countries list
  const renderCountryRow = ({ index, style }: ListChildComponentProps) => {
    const country = filteredCountries[index];
    return (
      <div
        style={style}
        key={country.code}
        className="px-3 py-2 border-b last:border-b-0"
      >
        <button
          type="button"
          onClick={() => {
            setSelectedCountry(country.code);
            setCountryDialogOpen(false);
          }}
          className="w-full flex items-center justify-between gap-3 text-left hover:bg-accent rounded-md px-2 py-2"
        >
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs bg-gray-200"></div>
            <span className="font-medium truncate hover:bg-accent">
              {country.name}
            </span>
          </div>
          <span className="font-bold text-primary">
            {waitingForTvPrice && selectedProvider === "panda" ? (
              <Spinner className="h-4 w-4 animate-spin" />
            ) : (
              `₦${(country.priceNgn || 0).toLocaleString()}`
            )}
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-7xl">
      <Button variant="ghost" onClick={() => router.back()} className="mb-4">
        ← Back
      </Button>

      {/* Hybrid Layout: Mobile stacks vertically, Desktop uses sidebar */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column - Main Content (Mobile: full width, Desktop: 2/3) */}
        <div className="flex-1 lg:w-2/3 space-y-6">
          {/* Balance & Provider Info - TOP on Mobile, Hidden on Desktop */}
          <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Balance Card */}
            <Card className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <p className="text-sm font-medium text-muted-foreground">
                  Available Balance
                </p>
              </div>
              <p className="text-2xl md:text-3xl font-bold">
                ₦{balance.toLocaleString()}
              </p>
              <Button
                variant="link"
                className="p-0 h-auto mt-2 text-sm"
                onClick={() => router.push("/wallet")}
              >
                Add funds →
              </Button>
            </Card>

            {/* Current Provider Card */}
            {currentProvider && (
              <Card className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center text-xl font-bold">
                    {currentProvider.displayName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-sm">
                      {currentProvider.displayName}
                    </h3>
                    <Badge variant="secondary" className="text-xs mt-1">
                      Active Provider
                    </Badge>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Main Order Form */}
          <Card className="p-6 md:p-8">
            <h1 className="text-2xl md:text-3xl font-bold mb-6">Buy Number</h1>

            {error && (
              <Alert className="mb-6 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <div className="ml-2 text-sm text-red-800 dark:text-red-200">
                  {error}
                </div>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6" id="order-form">
              {/* Provider Selection */}
              <div>
                <Label className="mb-3 block text-base font-semibold">
                  Select Provider
                </Label>

                {/* Mobile: Dialog Trigger */}
                <div className="lg:hidden">
                  <Dialog
                    open={providerDialogOpen}
                    onOpenChange={setProviderDialogOpen}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-14 justify-between text-left font-normal"
                      disabled={creating}
                      onClick={() => setProviderDialogOpen(true)}
                    >
                      {currentProvider ? (
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-lg flex items-center justify-center text-2xl font-bold ${
                              currentProvider.name
                                .toLowerCase()
                                .includes("lion") ||
                              currentProvider.name
                                .toLowerCase()
                                .includes("sms-man")
                                ? "bg-amber-100 dark:bg-amber-900"
                                : currentProvider.name
                                      .toLowerCase()
                                      .includes("panda") ||
                                    currentProvider.name
                                      .toLowerCase()
                                      .includes("textverified")
                                  ? "bg-green-100 dark:bg-green-900"
                                  : "bg-primary/10"
                            }`}
                          >
                            {currentProvider.name
                              .toLowerCase()
                              .includes("lion") ||
                            currentProvider.name
                              .toLowerCase()
                              .includes("sms-man")
                              ? "🦁"
                              : currentProvider.name
                                    .toLowerCase()
                                    .includes("panda") ||
                                  currentProvider.name
                                    .toLowerCase()
                                    .includes("textverified")
                                ? "🐼"
                                : currentProvider.displayName.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold">
                              {currentProvider.displayName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {currentProvider.cover}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          Select a provider
                        </span>
                      )}
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </Button>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Select Provider</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3 py-4">
                        {providers.length === 0 && (
                          <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
                            No providers available right now. Pull to refresh or
                            try again later.
                          </div>
                        )}
                        {providers.map((provider) => {
                          // Map provider icons based on name
                          const getProviderIcon = (name: string) => {
                            return (
                              provider.logo ||
                              (name.toLowerCase().includes("lion") ||
                              name.toLowerCase().includes("sms-man")
                                ? "🦁"
                                : name.toLowerCase().includes("panda") ||
                                    name.toLowerCase().includes("textverified")
                                  ? "🐼"
                                  : provider.displayName.charAt(0))
                            );
                          };

                          const getProviderBg = (name: string) => {
                            if (
                              name.toLowerCase().includes("lion") ||
                              name.toLowerCase().includes("sms-man")
                            ) {
                              return selectedProvider === provider.id
                                ? "bg-amber-500 text-white"
                                : "bg-amber-100 dark:bg-amber-900";
                            }
                            if (
                              name.toLowerCase().includes("panda") ||
                              name.toLowerCase().includes("textverified")
                            ) {
                              return selectedProvider === provider.id
                                ? "bg-green-500 text-white"
                                : "bg-green-100 dark:bg-green-900";
                            }
                            return selectedProvider === provider.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-primary/10 text-primary";
                          };

                          return (
                            <button
                              key={provider.id}
                              type="button"
                              onClick={() => {
                                setSelectedProvider(provider.id);
                                setProviderDialogOpen(false);
                              }}
                              className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                                selectedProvider === provider.id
                                  ? "border-primary bg-primary/5 shadow-md"
                                  : "border-gray-200 hover:border-primary/50 dark:border-gray-700"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 flex-1">
                                  <div
                                    className={`w-14 h-14 rounded-lg flex items-center justify-center text-2xl font-bold flex-shrink-0 ${getProviderBg(
                                      provider.cover,
                                    )}`}
                                  >
                                    {getProviderIcon(provider.name)}
                                  </div>
                                  <div>
                                    <h3 className="font-semibold text-base">
                                      {provider.displayName}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                      {provider.cover}
                                    </p>
                                  </div>
                                </div>
                                {selectedProvider === provider.id && (
                                  <CheckCircle2 className="w-6 h-6 text-primary flex-shrink-0" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                {/* Desktop: Card Grid */}
                <div className="hidden lg:grid lg:grid-cols-2 gap-4">
                  {providers.length === 0 ? (
                    <div className="col-span-2 p-4 text-center text-sm text-muted-foreground border rounded-md">
                      No providers available. Please try again later.
                    </div>
                  ) : (
                    providers.map((provider) => {
                      // Map provider icons based on name
                      const getProviderIcon = (name: string) => {
                        return (
                          provider.logo ||
                          (name.toLowerCase().includes("lion") ||
                          name.toLowerCase().includes("sms-man")
                            ? "🦁"
                            : name.toLowerCase().includes("panda") ||
                                name.toLowerCase().includes("textverified")
                              ? "🐼"
                              : provider.displayName.charAt(0))
                        );
                      };

                      const getProviderBg = (name: string) => {
                        if (
                          name.toLowerCase().includes("lion") ||
                          name.toLowerCase().includes("sms-man")
                        ) {
                          return selectedProvider === provider.id
                            ? "bg-amber-500"
                            : "bg-amber-100 dark:bg-amber-900";
                        }
                        if (
                          name.toLowerCase().includes("panda") ||
                          name.toLowerCase().includes("textverified")
                        ) {
                          return selectedProvider === provider.id
                            ? "bg-green-500"
                            : "bg-green-100 dark:bg-green-900";
                        }
                        return selectedProvider === provider.id
                          ? "bg-primary"
                          : "bg-primary/10";
                      };

                      return (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedProvider(provider.id);
                          }}
                          disabled={creating}
                          className={`p-5 rounded-xl border-2 transition-all text-left hover:shadow-lg active:scale-[0.98] ${
                            selectedProvider === provider.id
                              ? "border-primary bg-primary/5 shadow-lg ring-2 ring-primary/30"
                              : "border-gray-200 hover:border-primary/50 hover:bg-accent dark:border-gray-700 dark:hover:border-primary/50"
                          } ${
                            creating
                              ? "opacity-50 cursor-not-allowed"
                              : "cursor-pointer"
                          }`}
                          style={{
                            userSelect: "none",
                            WebkitUserSelect: "none",
                          }}
                        >
                          <div className="flex items-start gap-4">
                            <div
                              className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-bold flex-shrink-0 transition-all ${getProviderBg(
                                provider.cover,
                              )} ${
                                selectedProvider === provider.id
                                  ? "text-white"
                                  : ""
                              }`}
                            >
                              {getProviderIcon(provider.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <h3 className="font-bold text-lg mb-1">
                                    {provider.displayName}
                                  </h3>
                                  <p className="text-sm text-muted-foreground">
                                    {provider.cover}
                                  </p>
                                </div>
                                {selectedProvider === provider.id && (
                                  <CheckCircle2 className="w-6 h-6 text-primary flex-shrink-0 animate-in zoom-in duration-200" />
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Service Selection - Virtualized Dialog */}
              <div>
                <Label className="mb-2 block text-base font-semibold">
                  Service
                  {availableServices.length > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-xs font-normal"
                    >
                      {availableServices.length} available
                    </Badge>
                  )}
                </Label>

                <Dialog
                  open={serviceDialogOpen}
                  onOpenChange={setServiceDialogOpen}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-12 justify-between text-left"
                    disabled={creating || !selectedProvider}
                    onClick={() => setServiceDialogOpen(true)}
                  >
                    {selectedService ? (
                      <span className="truncate">
                        {allServices.find((s) => s.code === selectedService)?.ui
                          ?.displayName ||
                          allServices.find((s) => s.code === selectedService)
                            ?.name ||
                          "Selected service"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Select a service
                      </span>
                    )}
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </Button>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Select Service</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search services..."
                          value={serviceSearch}
                          onChange={(e) => setServiceSearch(e.target.value)}
                          className="pl-9 h-11"
                          disabled={creating || !selectedProvider}
                        />
                      </div>

                      {filteredServices.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
                          {selectedProvider
                            ? serviceSearch
                              ? "No services match your search"
                              : "No services available for this provider"
                            : "Please select a provider first"}
                        </div>
                      ) : (
                        <div className="rounded-md border">
                          {/* Virtualized list to handle thousands of items smoothly */}
                          <List
                            height={400}
                            width="100%"
                            itemCount={filteredServices.length}
                            itemSize={52}
                          >
                            {renderServiceRow}
                          </List>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Country Selection - Virtualized Dialog */}
              <div>
                <Label className="mb-2 block text-base font-semibold">
                  Country
                  {availableCountries.length > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-xs font-normal"
                    >
                      {availableCountries.length} available
                    </Badge>
                  )}
                </Label>

                <Dialog
                  open={countryDialogOpen}
                  onOpenChange={setCountryDialogOpen}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-12 justify-between text-left"
                    disabled={
                      creating ||
                      !selectedService ||
                      countriesLoading
                    }
                    onClick={() => setCountryDialogOpen(true)}
                  >
                    {countriesLoading ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Spinner className="h-4 w-4" />
                        Loading countries...
                      </span>
                    ) : selectedCountry ? (
                      <span className="truncate">
                        {countryNameByCode.get(
                          String(selectedCountry).toUpperCase(),
                        ) ||
                          availableCountries.find(
                            (c) => c.code === selectedCountry,
                          )?.name ||
                          selectedCountry}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Select a country
                      </span>
                    )}
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </Button>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Select Country</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search countries..."
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          className="pl-9 h-11"
                          disabled={creating || !selectedService || countriesLoading}
                        />
                      </div>

                      {countriesLoading ? (
                        <div className="p-8 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground border rounded-md">
                          <Spinner className="h-5 w-5" />
                          Loading countries for this service...
                        </div>
                      ) : filteredCountries.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
                          {selectedService
                            ? "No countries available for this service"
                            : "Please select a service first"}
                        </div>
                      ) : (
                        <div className="rounded-md border">
                          <List
                            height={400}
                            width="100%"
                            itemCount={filteredCountries.length}
                            itemSize={52}
                          >
                            {renderCountryRow}
                          </List>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Submit Button - Mobile */}
              <Button
                type="submit"
                className="w-full h-12 text-base lg:hidden"
                disabled={
                  creating ||
                  waitingForTvPrice ||
                  insufficientBalance ||
                  !selectedService ||
                  !selectedCountry ||
                  !selectedProvider
                }
              >
                {creating ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Processing...
                  </>
                ) : waitingForTvPrice ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Fetching price...
                  </>
                ) : insufficientBalance ? (
                  "Insufficient Balance"
                ) : (
                  "Buy Number"
                )}
              </Button>
            </form>
          </Card>
        </div>

        {/* Right Sidebar - Desktop Only */}
        <div className="hidden lg:block lg:w-1/3">
          <div className="sticky top-6 space-y-4">
            {/* Balance Card */}
            <Card className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 shadow-lg">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <p className="text-sm font-medium text-muted-foreground">
                  Available Balance
                </p>
              </div>
              <p className="text-3xl font-bold mb-3">
                ₦{balance.toLocaleString()}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => router.push("/wallet")}
              >
                Add Funds
              </Button>
            </Card>

            {/* Current Provider Card */}
            {currentProvider && (
              <Card className="p-5 shadow-lg border-2 border-primary/20">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center text-xl font-bold flex-shrink-0">
                    {currentProvider.displayName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-base">
                      {currentProvider.displayName}
                    </h3>
                    <Badge variant="default" className="text-xs mt-1">
                      Active Provider
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  This provider will be used to purchase your virtual number.
                </p>
              </Card>
            )}

            {/* Order Summary */}
            {currentService ? (
              <Card className="p-5 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 shadow-lg">
                <h3 className="font-bold mb-4 text-lg flex items-center gap-2">
                  <span>Order Summary</span>
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Service:</span>
                    <span className="font-semibold">
                      {currentService?.ui?.displayName || currentService.name}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Country:</span>
                    <span className="font-semibold">
                      {selectedCountry
                        ? countryNameByCode.get(
                            String(selectedCountry).toUpperCase(),
                          ) ||
                          currentCountry?.name ||
                          selectedCountry
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Provider:</span>
                    <span className="font-semibold">
                      {currentProvider?.displayName}
                    </span>
                  </div>
                  <div className="pt-3 border-t-2 border-gray-300 dark:border-gray-600 mt-3">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-base">Total:</span>
                      <span
                        className={`font-bold text-2xl ${
                          insufficientBalance ? "text-red-600" : "text-primary"
                        }`}
                      >
                        {waitingForTvPrice ? (
                          <span className="inline-flex items-center gap-2 text-base font-medium">
                            <Spinner className="h-4 w-4" />
                            Fetching price...
                          </span>
                        ) : (
                          <>₦{currentPriceNgn.toLocaleString()}</>
                        )}
                      </span>
                    </div>
                    {insufficientBalance && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                        <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                          ⚠️ Insufficient balance
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          Need ₦{(currentPriceNgn - balance).toLocaleString()}{" "}
                          more
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Submit Button - Desktop */}
                <Button
                  type="submit"
                  onClick={handleSubmit}
                  className="w-full h-12 text-base mt-5 shadow-lg"
                  disabled={
                    creating ||
                    waitingForTvPrice ||
                    insufficientBalance ||
                    !selectedService ||
                    !selectedCountry ||
                    !selectedProvider
                  }
                >
                  {creating ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Processing...
                    </>
                  ) : waitingForTvPrice ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Fetching price...
                    </>
                  ) : insufficientBalance ? (
                    "Insufficient Balance"
                  ) : (
                    "Buy Number Now"
                  )}
                </Button>
              </Card>
            ) : (
              <Card className="p-5 bg-gray-50 dark:bg-gray-900 border-dashed">
                <p className="text-sm text-muted-foreground text-center py-8">
                  Select a service and country to see the order summary
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
