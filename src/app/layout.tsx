import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { BottomNav, MobileNav, Sidebar } from "@/components/sidebar";
import "./globals.css";

// Same setup as D:/projects/SEO/video-downloader: latin-ext + vietnamese hold ă, đ, ơ, ư —
// without them Vietnamese text falls back to another font mid-word.
const sans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "DETOLA · AI KOC Discovery",
  description: "Tìm và đề xuất KOC TikTok mỹ phẩm dựa trên bằng chứng",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full text-[13px]">
        {/* usePathname() is request data → keep it inside a Suspense boundary */}
        <Suspense fallback={<div className="hidden w-64 shrink-0 border-r border-line bg-white lg:block" />}>
          <Sidebar />
        </Suspense>
        {/* Khoảng chừa cho thanh tab dưới (mobile) nằm trong chính `BottomNav` — trang nào ẩn thanh thì không thừa khoảng trống */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Dưới lg không có sidebar → thanh trên (logo) + thanh tab dưới thay thế */}
          <Suspense fallback={<div className="h-[53px] border-b border-line bg-white lg:hidden" />}>
            <MobileNav />
          </Suspense>
          {children}
          <Suspense fallback={null}>
            <BottomNav />
          </Suspense>
        </div>
      </body>
    </html>
  );
}
