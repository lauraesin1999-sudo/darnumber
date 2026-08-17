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


const DarIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      viewBox="0 0 50 50"
      enableBackground="new 0 0 50 50"
      id="Layer_1"
      version="1.1"
      xmlSpace="preserve"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      fill="currentColor"
      className={className || "w-5 h-5"}
    >
      <g id="SVGRepo_bgCarrier" strokeWidth="0" />
      <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round" />
      <g id="SVGRepo_iconCarrier">
        <g>
          <g>
            <circle cx="24.9998" cy="24.9999" fill="#E7E3E6" r="23.27273" />
          </g>
          <g>
            <g>
              <path
                d="M24.99997,49c-13.23343,0-24-10.76657-24-24s10.76657-24,24-24s24,10.76657,24,24 S38.2334,49,24.99997,49z M24.99997,2.45455C12.56815,2.45455,2.45452,12.56818,2.45452,25s10.11364,22.54546,22.54545,22.54546 S47.54543,37.43182,47.54543,25S37.43179,2.45455,24.99997,2.45455z"
                fill="#D2D2D2"
              />
            </g>
            <g>
              <path
                d="M24.99997,49c-7.79072,0-14.12879-10.76657-14.12879-24S17.20925,1,24.99997,1 c7.79025,0,14.12831,10.76657,14.12831,24S32.79022,49,24.99997,49z M24.99997,2.45455 c-6.98864,0-12.67424,10.11364-12.67424,22.54545s5.68561,22.54546,12.67424,22.54546 c6.98816,0,12.67377-10.11364,12.67377-22.54546S31.98813,2.45455,24.99997,2.45455z"
                fill="#D2D2D2"
              />
            </g>
            <g>
              <rect fill="#D2D2D2" height="46.54546" width="1.45455" x="24.2727" y="1.72727" />
            </g>
            <g>
              <path
                d="M24.99997,39.12831c-13.23343,0-24-6.33807-24-14.12831c0-7.79072,10.76657-14.12879,24-14.12879 s24,6.33807,24,14.12879C48.99997,32.79025,38.2334,39.12831,24.99997,39.12831z M24.99997,12.32576 C12.56815,12.32576,2.45452,18.01136,2.45452,25c0,6.98816,10.11364,12.67377,22.54545,12.67377S47.54543,31.98816,47.54543,25 C47.54543,18.01136,37.43179,12.32576,24.99997,12.32576z"
                fill="#D2D2D2"
              />
            </g>
            <g>
              <rect fill="#D2D2D2" height="1.45455" width="46.54546" x="1.72724" y="24.27273" />
            </g>
          </g>
          <g>
            <path
              d="M48.27253,15.37993c0,6.49892-6.43774,11.58021-6.43774,11.58021s-6.43774-5.08129-6.43774-11.58021 c0-3.55546,2.88227-6.43774,6.43774-6.43774C45.39026,8.94219,48.27253,11.82447,48.27253,15.37993z"
              fill="#FFC966"
            />
            <circle cx="41.83479" cy="15.37993" fill="#FFFFFF" r="3.83097" />
          </g>
          <g>
            <path
              d="M14.76308,10.01486c0,6.49892-6.43774,11.58021-6.43774,11.58021s-6.43774-5.08129-6.43774-11.58021 c0-3.55546,2.88227-6.43774,6.43774-6.43774S14.76308,6.4594,14.76308,10.01486z"
              fill="#53B1E2"
            />
            <circle cx="8.32535" cy="10.01486" fill="#FFFFFF" r="3.83097" />
          </g>
          <g>
            <path
              d="M28.23072,34.03099c0,6.49892-6.43774,11.58022-6.43774,11.58022s-6.43774-5.08129-6.43774-11.58022 c0-3.55546,2.88227-6.43774,6.43774-6.43774S28.23072,30.47552,28.23072,34.03099z"
              fill="#EC6E62"
            />
            <circle cx="21.79298" cy="34.03099" fill="#FFFFFF" r="3.83097" />
          </g>
        </g>
      </g>
    </svg>
  );
};
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
    // {
    //   name: "Darads Services",
    //   href: "https://darads.com",
    //   icon: DarIcon
    // }
  ];

  const handleLogout = async () => {
    await logout();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === href;
    }
    return pathname.endsWith(href);
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
    const isExternal = item.href.startsWith("http");

    return (
      <Link
        key={item.name}
        href={item.href}
        prefetch={false}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        onClick={() => isMobile && setMobileMenuOpen(false)}
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
          isActive(item.href)
            ? "bg-blue-50 text-blue-600 font-medium"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm leading-tight truncate">{item.name}</span>
          {isExternal && (
            <span className="text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
              Check out our other services
            </span>
          )}
        </div>
      </Link>
    );
  })}

  {isAdmin && (
    <>
      <div className="border-t my-4" />
      <Link
        href="/admin"
        onClick={() => isMobile && setMobileMenuOpen(false)}
        className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors bg-gradient-to-r from-blue-50 to-blue-50 text-purple-600 font-medium border border-purple-200 hover:from-purple-100 hover:to-indigo-100"
      >
        <Shield className="w-5 h-5 shrink-0" />
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
