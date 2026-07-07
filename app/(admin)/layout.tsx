"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart,
  Wallet,
  User,
  Settings,
  Shield,
  LogOut,
  Menu,
  DollarSign,
  Zap,
  ChevronLeft,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Spinner } from "@/components/ui/spinner";

const adminNav = [
  {
    name: "Admin Dashboard",
    href: "/admin",
    icon: Shield,
  },
  {
    name: "Users",
    href: "/admin/users",
    icon: User,
  },
  {
    name: "Orders",
    href: "/admin/orders",
    icon: ShoppingCart,
  },
  {
    name: "Transactions",
    href: "/admin/transactions",
    icon: DollarSign,
  },
  {
    name: "Wallets",
    href: "/admin/wallets",
    icon: Wallet,
  },
  {
    name: "Providers",
    href: "/admin/providers",
    icon: Zap,
  },
  {
    name: "Settings",
    href: "/admin/settings",
    icon: Settings,
  },
];

interface SidebarContentProps {
  pathname: string;
  user: { name?: string | null; email: string; role?: string | null } | null;
  isMobile: boolean;
  onMobileClose: () => void;
  onLogout: () => void;
}

function AdminSidebarContent({
  pathname,
  user,
  isMobile,
  onMobileClose,
  onLogout,
}: SidebarContentProps) {
  const isActive = (href: string) => {
    if (href === "/admin") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      <div className="p-6 border-b bg-linear-to-r from-indigo-600 to-indigo-600">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-white" />
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        </div>
        <p className="text-sm text-purple-200 mt-1">DarNumber Management</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <Link
          href="/dashboard"
          prefetch={false}
          onClick={() => isMobile && onMobileClose()}
          className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-gray-600 hover:bg-gray-100 mb-4 border border-dashed"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </Link>

        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 mb-2">
          Administration
        </div>

        {adminNav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              onClick={() => isMobile && onMobileClose()}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive(item.href)
                  ? "bg-purple-50 text-purple-600 font-medium border-l-4 border-purple-600"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t bg-gray-50">
        <div className="mb-3 p-3 bg-white rounded-lg border">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <p className="text-xs text-gray-500">Admin Session</p>
          </div>
          <p className="text-sm font-medium truncate">
            {user?.name || user?.email}
          </p>
          <p className="text-xs text-muted-foreground truncate">{user?.role}</p>
        </div>
        <Button variant="outline" className="w-full" onClick={onLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (
      !loading &&
      user &&
      user.role !== "ADMIN" &&
      user.role !== "SUPER_ADMIN"
    ) {
      router.push("/dashboard");
    }
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  const handleLogout = async () => {
    await logout();
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-gray-100">
        <header className="sticky top-0 z-50 w-full border-b bg-linear-to-r from-purple-600 to-indigo-600">
          <div className="flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-white" />
              <h1 className="text-lg font-bold text-white">Admin Panel</h1>
            </div>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-purple-500"
                >
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <div className="flex flex-col h-full">
                  <AdminSidebarContent
                    pathname={pathname}
                    user={user}
                    isMobile={isMobile}
                    onMobileClose={closeMobileMenu}
                    onLogout={handleLogout}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-gray-100">
        <Sidebar className="border-r bg-white w-64 shrink-0">
          <SidebarContent className="flex flex-col h-full">
            <AdminSidebarContent
              pathname={pathname}
              user={user}
              isMobile={isMobile}
              onMobileClose={closeMobileMenu}
              onLogout={handleLogout}
            />
          </SidebarContent>
        </Sidebar>

        <SidebarInset className="flex-1 min-w-0">
          <header className="px-4 sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-white">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-600">Admin</span>
              <span className="text-gray-300">/</span>
              <span className="text-sm text-muted-foreground">
                {pathname.split("/").filter(Boolean).slice(1).join(" / ") ||
                  "Dashboard"}
              </span>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
