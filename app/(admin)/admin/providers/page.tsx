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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Settings,
  Zap,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Edit,
  RotateCcw,
  Link,
} from "lucide-react";
import { logger } from "@/lib/logger";

const getHealthColor = (status: string) => {
  const colors: Record<string, string> = {
    HEALTHY: "bg-green-100 text-green-800",
    DEGRADED: "bg-yellow-100 text-yellow-800",
    DOWN: "bg-red-100 text-red-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
};

const getHealthIcon = (status: string) => {
  switch (status) {
    case "HEALTHY":
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    case "DEGRADED":
      return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    case "DOWN":
      return <XCircle className="w-4 h-4 text-red-600" />;
    default:
      return <Activity className="w-4 h-4 text-gray-600" />;
  }
};

export default function AdminProvidersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Edit modal
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: "",
    apiUrl: "",
    priority: 0,
    rateLimit: 1000,
    isActive: true,
    healthStatus: "HEALTHY",
  });

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const response = await api.getProviders();
      setProviders(response.data || []);
    } catch (error: any) {
      logger.error("Failed to fetch providers:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else {
        toast.error("Failed to load providers", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (provider: any) => {
    setActionLoading(provider.id);
    try {
      await api.updateProvider(provider.id, { isActive: !provider.isActive });
      toast.success(
        provider.isActive ? "Provider disabled" : "Provider enabled",
        `${provider.displayName} has been ${
          provider.isActive ? "disabled" : "enabled"
        }.`
      );
      fetchProviders();
    } catch (error: any) {
      toast.error(
        "Update failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleSync = async (provider: any) => {
    setActionLoading(`sync-${provider.id}`);
    try {
      await api.syncProvider(provider.id);
      toast.success(
        "Sync started",
        `Syncing services for ${provider.displayName}...`
      );
      fetchProviders();
    } catch (error: any) {
      toast.error(
        "Sync failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const openEditModal = (provider: any) => {
    setSelectedProvider(provider);
    setEditForm({
      displayName: provider.displayName,
      apiUrl: provider.apiUrl,
      priority: provider.priority,
      rateLimit: provider.rateLimit,
      isActive: provider.isActive,
      healthStatus: provider.healthStatus,
    });
    setEditModalOpen(true);
  };

  const handleSaveProvider = async () => {
    if (!selectedProvider) return;
    setActionLoading("save");
    try {
      await api.updateProvider(selectedProvider.id, editForm);
      toast.success(
        "Provider updated",
        `${editForm.displayName} has been updated.`
      );
      setEditModalOpen(false);
      fetchProviders();
    } catch (error: any) {
      toast.error(
        "Update failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleString();
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
        <h1 className="text-3xl font-bold">SMS Providers</h1>
        <Button variant="outline" onClick={() => fetchProviders()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {providers.map((provider) => (
          <Card key={provider.id} className="overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      provider.isActive ? "bg-blue-100" : "bg-gray-100"
                    }`}
                  >
                    <Zap
                      className={`w-5 h-5 ${
                        provider.isActive ? "text-blue-600" : "text-gray-400"
                      }`}
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold">{provider.displayName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {provider.name}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={provider.isActive}
                  onCheckedChange={() => handleToggleActive(provider)}
                  disabled={actionLoading === provider.id}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Health Status
                  </span>
                  <div className="flex items-center gap-2">
                    {getHealthIcon(provider.healthStatus)}
                    <Badge className={getHealthColor(provider.healthStatus)}>
                      {provider.healthStatus}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Priority
                  </span>
                  <span className="font-medium">{provider.priority}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Rate Limit
                  </span>
                  <span className="font-medium">{provider.rateLimit}/hr</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Services
                  </span>
                  <span className="font-medium">
                    {provider._count?.services || 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Prices</span>
                  <span className="font-medium">
                    {provider._count?.providerPrices || 0}
                  </span>
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Last health check: {formatDate(provider.lastHealthCheck)}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-muted/30 border-t flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => openEditModal(provider)}
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleSync(provider)}
                disabled={actionLoading === `sync-${provider.id}`}
              >
                {actionLoading === `sync-${provider.id}` ? (
                  <Spinner className="w-4 h-4 mr-2" />
                ) : (
                  <Link className="w-4 h-4 mr-2" />
                )}
                Sync
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {providers.length === 0 && (
        <div className="text-center py-12">
          <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No Providers Found</h3>
          <p className="text-muted-foreground">
            Configure your SMS providers in the database.
          </p>
        </div>
      )}

      {/* Edit Provider Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
            <DialogDescription>{selectedProvider?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Display Name</Label>
              <Input
                value={editForm.displayName}
                onChange={(e) =>
                  setEditForm({ ...editForm, displayName: e.target.value })
                }
              />
            </div>
            <div>
              <Label>API URL</Label>
              <Input
                value={editForm.apiUrl}
                onChange={(e) =>
                  setEditForm({ ...editForm, apiUrl: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={editForm.priority}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      priority: parseInt(e.target.value) || 0,
                    })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Higher = more preferred
                </p>
              </div>
              <div>
                <Label>Rate Limit (per hour)</Label>
                <Input
                  type="number"
                  value={editForm.rateLimit}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      rateLimit: parseInt(e.target.value) || 1000,
                    })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Health Status</Label>
              <Select
                value={editForm.healthStatus}
                onValueChange={(val) =>
                  setEditForm({ ...editForm, healthStatus: val })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HEALTHY">Healthy</SelectItem>
                  <SelectItem value="DEGRADED">Degraded</SelectItem>
                  <SelectItem value="DOWN">Down</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={editForm.isActive}
                onCheckedChange={(checked) =>
                  setEditForm({ ...editForm, isActive: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveProvider}
              disabled={actionLoading === "save"}
            >
              {actionLoading === "save" ? (
                <Spinner className="w-4 h-4" />
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
