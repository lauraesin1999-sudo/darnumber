"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  User,
  Shield,
  LogOut,
  Menu,
  DollarSign,
  PlusCircle,
  Phone,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      name: "Buy Numbers",
      href: "/orders/new",
      icon: PlusCircle,
    },
    {
      name: "Orders",
      href: "/orders",
      icon: ShoppingCart,
    },
    {
      name: "Wallet",
      href: "/wallet",
      icon: Wallet,
    },
    {
      name: "Transactions",
      href: "/transactions",
      icon: DollarSign,
    },
    {
      name: "Profile",
      href: "/profile",
      icon: User,
    },
    {
      name: "Contact Us",
      href: "/contact",
      icon: Phone,
    },
  ];

  const handleLogout = async () => {
    await logout();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const SidebarContentComponent = () => (
    <>
      <div className="p-6 border-b">
        <Link href="/" className="block">
          <h1 className="text-2xl font-bold text-blue-600">DarNumber</h1>
          <p className="text-sm text-muted-foreground mt-1">SMS Verification</p>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              onClick={() => isMobile && setMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive(item.href)
                  ? "bg-blue-50 text-blue-600 font-medium"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.name}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="border-t my-4" />
            <Link
              href="/admin"
              onClick={() => isMobile && setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-600 font-medium border border-purple-200 hover:from-purple-100 hover:to-indigo-100"
            >
              <Shield className="w-5 h-5" />
              Admin Panel
            </Link>
          </>
        )}
      </nav>

      <div className="p-4 border-t">
        <div className="mb-3 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium truncate">
            {user?.name || user?.email}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {user?.email}
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        {/* Mobile Header */}
        <header className="sticky top-0 z-50 w-full border-b bg-white">
          <div className="flex h-16 items-center justify-between px-4">
            <h1 className="text-xl font-bold text-blue-600">DarNumber</h1>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex flex-col h-full">
                  <SidebarContentComponent />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {/* Mobile Main Content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-gray-50">
        {/* Desktop Sidebar */}
        <Sidebar className="border-r bg-white">
          <SidebarContent className="flex flex-col h-full">
            <SidebarContentComponent />
          </SidebarContent>
        </Sidebar>

        {/* Desktop Main Content */}
        <SidebarInset className="flex-1">
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-white px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {pathname.split("/").filter(Boolean).join(" / ")}
              </span>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
