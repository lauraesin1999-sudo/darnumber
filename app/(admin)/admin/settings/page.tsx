"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw,
  Settings,
  Plus,
  Edit,
  Trash2,
  Percent,
  DollarSign,
  Globe,
  Tag,
} from "lucide-react";

export default function AdminSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<{
    usdToNgn?: number;
    usdToRub?: number;
    source?: string;
    timestamp?: string;
  } | null>(null);
  const [ratesRefreshing, setRatesRefreshing] = useState(false);

  // Create/Edit modal
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleForm, setRuleForm] = useState({
    serviceCode: "",
    country: "",
    profitType: "PERCENTAGE",
    profitValue: "",
    profitCurrency: "USD" as "USD" | "NGN",
    priority: 0,
    isActive: true,
  });

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<any>(null);

  useEffect(() => {
    fetchPricingRules();
    fetchExchangeRates();
  }, []);

  const fetchPricingRules = async () => {
    setLoading(true);
    try {
      const response = await api.getPricingRules();
      setPricingRules(response.data || []);
    } catch (error: any) {
      console.error("Failed to fetch pricing rules:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else {
        toast.error("Failed to load settings", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchExchangeRates = async () => {
    try {
      const res = await fetch("/api/exchange-rates");
      if (!res.ok) return;
      const json = await res.json();
      setExchangeRates(json?.data || null);
    } catch (err) {
      console.error("Failed to fetch exchange rates:", err);
    }
  };

  const handleRefreshRates = async () => {
    setRatesRefreshing(true);
    try {
      const res = await fetch("/api/exchange-rates/refresh");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || "Refresh failed");
      }
      toast.success("Rates refreshed", "Live rates loaded from MoneyConvert.");
      await fetchExchangeRates();
    } catch (error: any) {
      toast.error(
        "Refresh failed",
        error?.message || "Could not refresh exchange rates.",
      );
    } finally {
      setRatesRefreshing(false);
    }
  };

  const openCreateModal = () => {
    setEditingRule(null);
    setRuleForm({
      serviceCode: "",
      country: "",
      profitType: "PERCENTAGE",
      profitValue: "",
      profitCurrency: "USD",
      priority: 0,
      isActive: true,
    });
    setRuleModalOpen(true);
  };

  const openEditModal = (rule: any) => {
    setEditingRule(rule);
    setRuleForm({
      serviceCode: rule.serviceCode || "",
      country: rule.country || "",
      profitType: rule.profitType,
      profitValue: rule.profitValue?.toString() || "",
      profitCurrency: rule.profitCurrency === "NGN" ? "NGN" : "USD",
      priority: rule.priority,
      isActive: rule.isActive,
    });
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    if (!ruleForm.profitValue) {
      toast.error("Invalid input", "Please enter a profit value.");
      return;
    }

    setActionLoading(true);
    try {
      const payload = {
        serviceCode: ruleForm.serviceCode || null,
        country: ruleForm.country || null,
        profitType: ruleForm.profitType,
        profitValue: parseFloat(ruleForm.profitValue),
        // Currency only applies to FIXED markups; always send for clarity
        profitCurrency:
          ruleForm.profitType === "FIXED" ? ruleForm.profitCurrency : "USD",
        priority: ruleForm.priority,
        isActive: ruleForm.isActive,
      };

      if (editingRule) {
        await api.updatePricingRule(editingRule.id, payload);
        toast.success("Rule updated", "Pricing rule has been updated.");
      } else {
        await api.createPricingRule(payload);
        toast.success("Rule created", "New pricing rule has been created.");
      }
      setRuleModalOpen(false);
      fetchPricingRules();
    } catch (error: any) {
      toast.error(
        "Save failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    setActionLoading(true);
    try {
      await api.deletePricingRule(ruleToDelete.id);
      toast.success("Rule deleted", "Pricing rule has been deleted.");
      setDeleteDialogOpen(false);
      setRuleToDelete(null);
      fetchPricingRules();
    } catch (error: any) {
      toast.error(
        "Delete failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleRule = async (rule: any) => {
    try {
      await api.updatePricingRule(rule.id, { isActive: !rule.isActive });
      toast.success(
        rule.isActive ? "Rule disabled" : "Rule enabled",
        `Pricing rule has been ${rule.isActive ? "disabled" : "enabled"}.`
      );
      fetchPricingRules();
    } catch (error: any) {
      toast.error(
        "Update failed",
        error.response?.data?.error?.message || "Please try again."
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <Tabs defaultValue="pricing" className="space-y-6">
        <TabsList>
          <TabsTrigger value="pricing">Pricing Rules</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>

        {/* Pricing Rules Tab */}
        <TabsContent value="pricing" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Pricing Rules</h2>
              <p className="text-muted-foreground">
                Configure profit margins for services. Higher priority rules
                take precedence.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => fetchPricingRules()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={openCreateModal}>
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </div>
          </div>

          {/* Rules Table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Service
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Country
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Profit Type
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Profit Value
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Priority
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pricingRules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Tag className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">
                            {rule.serviceCode || "All Services"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-muted-foreground" />
                          <span>{rule.country || "All Countries"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            rule.profitType === "PERCENTAGE"
                              ? "border-blue-200 text-blue-700"
                              : "border-green-200 text-green-700"
                          }
                        >
                          {rule.profitType === "PERCENTAGE" ? (
                            <Percent className="w-3 h-3 mr-1" />
                          ) : (
                            <DollarSign className="w-3 h-3 mr-1" />
                          )}
                          {rule.profitType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {rule.profitType === "PERCENTAGE"
                          ? `${rule.profitValue}%`
                          : rule.profitCurrency === "NGN"
                            ? `₦${Number(rule.profitValue).toFixed(2)}`
                            : `$${Number(rule.profitValue).toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{rule.priority}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={() => handleToggleRule(rule)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(rule)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600"
                            onClick={() => {
                              setRuleToDelete(rule);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pricingRules.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No pricing rules configured.</p>
                <p className="text-sm">
                  Click "Add Rule" to create your first pricing rule.
                </p>
              </div>
            )}
          </Card>

          {/* Info Card */}
          <Card className="p-4 bg-blue-50 border-blue-200">
            <h3 className="font-medium text-blue-800 mb-2">
              How Pricing Rules Work
            </h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>
                • Customer price = <strong>provider cost + markup</strong>
              </li>
              <li>
                • Rules with higher priority take precedence over lower priority
                rules
              </li>
              <li>• Specific service/country rules override general rules</li>
              <li>
                • Percentage: markup is a % of the provider cost (e.g. 20%)
              </li>
              <li>
                • Fixed: flat markup in <strong>USD</strong> or{" "}
                <strong>NGN</strong> (choose currency when creating the rule)
              </li>
              <li>• Leave service or country empty to apply to all</li>
            </ul>
          </Card>
        </TabsContent>

        {/* General Settings Tab */}
        <TabsContent value="general" className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Exchange Rates</h2>
                <p className="text-sm text-muted-foreground">
                  Live rates from MoneyConvert (free). Used to convert provider
                  costs (RUB/USD) into customer NGN prices. Fallback USD/NGN =
                  1600 if the API is unavailable.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleRefreshRates}
                disabled={ratesRefreshing}
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${ratesRefreshing ? "animate-spin" : ""}`}
                />
                Refresh Rates
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">1 USD → NGN</p>
                <p className="text-2xl font-semibold">
                  {exchangeRates?.usdToNgn != null
                    ? `₦${Number(exchangeRates.usdToNgn).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}`
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">1 USD → RUB</p>
                <p className="text-2xl font-semibold">
                  {exchangeRates?.usdToRub != null
                    ? `₽${Number(exchangeRates.usdToRub).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}`
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Source / Updated</p>
                <p className="text-sm font-medium">
                  {exchangeRates?.source || "moneyconvert.net"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {exchangeRates?.timestamp
                    ? new Date(exchangeRates.timestamp).toLocaleString()
                    : "Not loaded"}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">General Settings</h2>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label>Default Currency</Label>
                  <Select defaultValue="NGN">
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">Nigerian Naira (NGN)</SelectItem>
                      <SelectItem value="USD">US Dollar (USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Minimum Deposit</Label>
                  <Input type="number" defaultValue="100" className="mt-1" />
                </div>
                <div>
                  <Label>Minimum Withdrawal</Label>
                  <Input type="number" defaultValue="500" className="mt-1" />
                </div>
                <div>
                  <Label>Referral Bonus (%)</Label>
                  <Input type="number" defaultValue="5" className="mt-1" />
                </div>
              </div>
              <div className="flex justify-end pt-4 border-t">
                <Button>Save Settings</Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Maintenance Mode</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enable Maintenance Mode</p>
                <p className="text-sm text-muted-foreground">
                  When enabled, users will see a maintenance message instead of
                  the app.
                </p>
              </div>
              <Switch />
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Rule Modal */}
      <Dialog open={ruleModalOpen} onOpenChange={setRuleModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRule ? "Edit Pricing Rule" : "Create Pricing Rule"}
            </DialogTitle>
            <DialogDescription>
              Configure profit margins for services.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Service Code (optional)</Label>
              <Input
                value={ruleForm.serviceCode}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, serviceCode: e.target.value })
                }
                placeholder="e.g., google, whatsapp (leave empty for all)"
              />
            </div>
            <div>
              <Label>Country (optional)</Label>
              <Input
                value={ruleForm.country}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, country: e.target.value })
                }
                placeholder="e.g., US, RU, NG (leave empty for all)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Profit Type</Label>
                <Select
                  value={ruleForm.profitType}
                  onValueChange={(val) =>
                    setRuleForm({ ...ruleForm, profitType: val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="FIXED">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Profit Value{" "}
                  {ruleForm.profitType === "PERCENTAGE"
                    ? "(%)"
                    : ruleForm.profitCurrency === "NGN"
                      ? "(₦)"
                      : "($)"}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={ruleForm.profitValue}
                  onChange={(e) =>
                    setRuleForm({ ...ruleForm, profitValue: e.target.value })
                  }
                  placeholder={
                    ruleForm.profitType === "PERCENTAGE"
                      ? "e.g., 20"
                      : ruleForm.profitCurrency === "NGN"
                        ? "e.g., 500"
                        : "e.g., 1.00"
                  }
                />
              </div>
            </div>
            {ruleForm.profitType === "FIXED" && (
              <div>
                <Label>Markup Currency</Label>
                <Select
                  value={ruleForm.profitCurrency}
                  onValueChange={(val) =>
                    setRuleForm({
                      ...ruleForm,
                      profitCurrency: val as "USD" | "NGN",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">
                      US Dollar (USD) — e.g. $1.00 flat
                    </SelectItem>
                    <SelectItem value="NGN">
                      Nigerian Naira (NGN) — e.g. ₦500 flat
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Final price = provider cost + this fixed amount. Provider
                  costs are converted from RUB/USD using live rates.
                </p>
              </div>
            )}
            <div>
              <Label>Priority</Label>
              <Input
                type="number"
                value={ruleForm.priority}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    priority: parseInt(e.target.value) || 0,
                  })
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Higher priority rules take precedence
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={ruleForm.isActive}
                onCheckedChange={(checked) =>
                  setRuleForm({ ...ruleForm, isActive: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRule} disabled={actionLoading}>
              {actionLoading ? (
                <Spinner className="w-4 h-4" />
              ) : editingRule ? (
                "Update"
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pricing Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              pricing rule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRule}
              className="bg-red-600 hover:bg-red-700"
            >
              {actionLoading ? <Spinner className="w-4 h-4" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
