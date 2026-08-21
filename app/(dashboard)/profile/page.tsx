"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  User,
  Mail,
  Phone,
  Globe,
  Shield,
  Wallet,
  Copy,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
} from "lucide-react";
import { logger } from "@/lib/logger";

interface UserProfile {
  id: string;
  email: string;
  userName: string;
  name?: string;
  phone?: string;
  country?: string;
  role: string;
  balance: number;
  referralCode?: string;
  createdAt: string;
  updatedAt: string;
}

interface UserStats {
  totalOrders: number;
  completedOrders: number;
  totalSpent: number;
  referralCount: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Edit form state
  const [formData, setFormData] = useState({
    userName: "",
    name: "",
    phone: "",
    country: "",
  });

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [changingPassword, setChangingPassword] = useState(false);

  // Bank details state
  const [bankDetails, setBankDetails] = useState({
    bankName: "",
    accountNumber: "",
    accountName: "",
  });
  const [showBankDialog, setShowBankDialog] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

  useEffect(() => {
    fetchProfileData();
  }, []);

  const fetchProfileData = async () => {
    try {
      const [profileRes, statsRes, balanceRes] = await Promise.all([
        api.getProfile(),
        api.getUserStats(),
        api.getBalance(),
      ]);

      const profileData = profileRes.data || profileRes;
      setProfile({
        ...profileData,
        balance: balanceRes.data?.balance || 0,
      });

      setStats(statsRes.data);

      setFormData({
        userName: profileData.userName || "",
        name: profileData.name || "",
        phone: profileData.phone || "",
        country: profileData.country || "",
      });
    } catch (error: any) {
      logger.error("Failed to fetch profile:", error);
      if (error.response?.status === 401) {
        toast.auth.sessionExpired();
        router.push("/login");
      } else {
        toast.error("Failed to load profile", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await api.updateProfile({
        userName: formData.userName,
        phone: formData.phone,
        country: formData.country,
      });

      toast.form.saveSuccess("Profile");
      setEditMode(false);
      fetchProfileData();
    } catch (error: any) {
      logger.error("Failed to update profile:", error);
      toast.form.saveError(
        error.response?.data?.message || "Failed to update profile"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("Passwords don't match", "Please make sure passwords match.");
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast.error(
        "Password too short",
        "Password must be at least 8 characters."
      );
      return;
    }

    setChangingPassword(true);
    try {
      await api.changePassword(
        passwordData.currentPassword,
        passwordData.newPassword
      );

      toast.auth.passwordResetSuccess();
      setShowPasswordChange(false);
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error: any) {
      logger.error("Failed to change password:", error);
      toast.error(
        "Password change failed",
        error.response?.data?.message || "Please check your current password."
      );
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSaveBankDetails = async () => {
    if (
      !bankDetails.bankName ||
      !bankDetails.accountNumber ||
      !bankDetails.accountName
    ) {
      toast.api.validationError("Please fill in all bank details.");
      return;
    }

    setSavingBank(true);
    try {
      await api.updateBankDetails({
        bankAccount: bankDetails.accountName,
        accountNumber: bankDetails.accountNumber,
        bankName: bankDetails.bankName,
      });

      toast.form.saveSuccess("Bank details");
      setShowBankDialog(false);
    } catch (error: any) {
      logger.error("Failed to save bank details:", error);
      toast.form.saveError(
        error.response?.data?.message || "Failed to save bank details"
      );
    } finally {
      setSavingBank(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.copy.success(label);
    } catch {
      toast.error("Failed to copy", "Could not copy to clipboard.");
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
    <div className="w-full">
      <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Profile</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account settings and preferences
            </p>
          </div>
          <Button
            variant="outline"
            onClick={fetchProfileData}
            className="w-full sm:w-auto"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Account Overview Card */}
        <Card className="p-4 md:p-6 bg-gradient-to-r from-primary/10 to-primary/5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold">
              {profile?.userName?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold">
                {profile?.name || profile?.userName}
              </h2>
              <p className="text-muted-foreground">{profile?.email}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary">{profile?.role || "USER"}</Badge>
                <Badge variant="outline" className="text-md">
                  Member since{" "}
                  {new Date(profile?.createdAt || "").toLocaleDateString(
                    "en-US",
                    {
                      year: "numeric",
                      month: "long",
                    }
                  )}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Balance</p>
              <p className="text-2xl font-bold text-primary">
                ₦{profile?.balance?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </Card>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.totalOrders}</p>
              <p className="text-sm text-muted-foreground">Total Orders</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.completedOrders}</p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">
                ₦{stats.totalSpent?.toLocaleString() || 0}
              </p>
              <p className="text-sm text-muted-foreground">Total Spent</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.referralCount || 0}</p>
              <p className="text-sm text-muted-foreground">Referrals</p>
            </Card>
          </div>
        )}

        {/* Profile Information */}
        <Card className="p-4 md:p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Profile Information</h2>
            {!editMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(true)}
              >
                Edit Profile
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditMode(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? (
                    <>
                      <Spinner className="h-4 w-4 mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Username
              </Label>
              {editMode ? (
                <Input
                  value={formData.userName}
                  onChange={(e) =>
                    setFormData({ ...formData, userName: e.target.value })
                  }
                  placeholder="Enter username"
                />
              ) : (
                <p className="text-sm font-medium">
                  {profile?.userName || "-"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <p className="text-sm font-medium">{profile?.email}</p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone
              </Label>
              {editMode ? (
                <Input
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="Enter phone number"
                />
              ) : (
                <p className="text-sm font-medium">{profile?.phone || "-"}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Country
              </Label>
              {editMode ? (
                <Select
                  value={formData.country}
                  onValueChange={(value) =>
                    setFormData({ ...formData, country: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NG">Nigeria</SelectItem>
                    <SelectItem value="US">United States</SelectItem>
                    <SelectItem value="GB">United Kingdom</SelectItem>
                    <SelectItem value="CA">Canada</SelectItem>
                    <SelectItem value="AU">Australia</SelectItem>
                    <SelectItem value="DE">Germany</SelectItem>
                    <SelectItem value="FR">France</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm font-medium">{profile?.country || "-"}</p>
              )}
            </div>
          </div>
        </Card>

        {/* Referral Code */}
        {profile?.referralCode && (
          <Card className="p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">Referral Program</h2>
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">
                  Your Referral Code
                </p>
                <p className="text-xl font-mono font-bold">
                  {profile.referralCode}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  copyToClipboard(profile.referralCode!, "Referral code")
                }
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Share your referral code with friends to earn rewards when they
              sign up.
            </p>
          </Card>
        )}

        {/* Security Section */}
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security
          </h2>

          {!showPasswordChange ? (
            <Button
              variant="outline"
              onClick={() => setShowPasswordChange(true)}
            >
              Change Password
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Current Password</Label>
                <div className="relative">
                  <Input
                    type={showPasswords.current ? "text" : "password"}
                    value={passwordData.currentPassword}
                    onChange={(e) =>
                      setPasswordData({
                        ...passwordData,
                        currentPassword: e.target.value,
                      })
                    }
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    onClick={() =>
                      setShowPasswords({
                        ...showPasswords,
                        current: !showPasswords.current,
                      })
                    }
                  >
                    {showPasswords.current ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showPasswords.new ? "text" : "password"}
                    value={passwordData.newPassword}
                    onChange={(e) =>
                      setPasswordData({
                        ...passwordData,
                        newPassword: e.target.value,
                      })
                    }
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    onClick={() =>
                      setShowPasswords({
                        ...showPasswords,
                        new: !showPasswords.new,
                      })
                    }
                  >
                    {showPasswords.new ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showPasswords.confirm ? "text" : "password"}
                    value={passwordData.confirmPassword}
                    onChange={(e) =>
                      setPasswordData({
                        ...passwordData,
                        confirmPassword: e.target.value,
                      })
                    }
                    placeholder="Confirm new password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    onClick={() =>
                      setShowPasswords({
                        ...showPasswords,
                        confirm: !showPasswords.confirm,
                      })
                    }
                  >
                    {showPasswords.confirm ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPasswordChange(false);
                    setPasswordData({
                      currentPassword: "",
                      newPassword: "",
                      confirmPassword: "",
                    });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                >
                  {changingPassword ? "Changing..." : "Change Password"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Bank Details */}
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Bank Details
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Add your bank details to enable withdrawals from your wallet.
          </p>
          <Button
            variant="outline"
            onClick={() => setShowBankDialog(true)}
            disabled={true}
          >
            Update Bank Details (coming soon)
          </Button>
        </Card>
      </div>

      {/* Bank Details Dialog */}
      <AlertDialog open={showBankDialog} onOpenChange={setShowBankDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Bank Details</AlertDialogTitle>
            <AlertDialogDescription>
              Enter your bank account details for withdrawals.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Bank Name</Label>
              <Input
                value={bankDetails.bankName}
                onChange={(e) =>
                  setBankDetails({ ...bankDetails, bankName: e.target.value })
                }
                placeholder="e.g., Access Bank"
              />
            </div>
            <div className="space-y-2">
              <Label>Account Number</Label>
              <Input
                value={bankDetails.accountNumber}
                onChange={(e) =>
                  setBankDetails({
                    ...bankDetails,
                    accountNumber: e.target.value,
                  })
                }
                placeholder="10-digit account number"
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input
                value={bankDetails.accountName}
                onChange={(e) =>
                  setBankDetails({
                    ...bankDetails,
                    accountName: e.target.value,
                  })
                }
                placeholder="Account holder name"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSaveBankDetails}
              disabled={savingBank}
            >
              {savingBank ? "Saving..." : "Save Details"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
