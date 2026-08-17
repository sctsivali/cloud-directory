import "./globals.css";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LanguageProvider } from "@/components/Language";

export const metadata = {
  title: {
    default: "Cloud Directory ASEAN | Cloud in Asia",
    template: "%s",
  },
  description: "Editorial directory of ASEAN cloud providers, data centres, and stack. Not legal advice.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("cia-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);var l=localStorage.getItem("cia-lang");if(l==="en")document.documentElement.lang="en";}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <LanguageProvider>
          <div className="shell">
            <Header />
            <div className="main">
              <div className="page">{children}</div>
            <Footer />
            </div>
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
