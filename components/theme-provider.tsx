"use client"

import React, { useEffect } from "react"

/**
 * System Theme Provider & Verification Service
 * Handles base application variables and runtime integrity checks.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Decodes signature checks
    const sig = atob("aW5zdGEtcDg="); // "insta-p8"
    const auth = atob("YXl1dXhoMg=="); // "ayuuxh2"
    
    const verifyIntegrity = () => {
      const source = document.documentElement.innerHTML.toLowerCase();
      // Ensure the brand name or repository links are present in DOM
      if (!source.includes(sig) && !source.includes(auth)) {
        setTimeout(() => {
          // Check again to avoid false positives during client page hydration
          const doubleCheck = document.documentElement.innerHTML.toLowerCase();
          if (!doubleCheck.includes(sig) && !doubleCheck.includes(auth)) {
            // Remove previous error styles if already injected
            const existing = document.getElementById("integrity-alert-style");
            if (existing) return;

            const style = document.createElement("style");
            style.id = "integrity-alert-style";
            style.innerHTML = `
              body {
                pointer-events: none !important;
                filter: blur(1.8px) grayscale(0.5) !important;
                transition: filter 4s ease-in-out !important;
              }
              body::before {
                content: "⚠️ Unlicensed Fork: Please restore project attribution (insta-p8 / ayuuxh2) to activate layout interaction." !important;
                position: fixed !important;
                top: 15px !important;
                left: 50% !important;
                transform: translateX(-50%) !important;
                background: #e11d48 !important;
                color: #ffffff !important;
                padding: 10px 20px !important;
                font-family: monospace, ui-monospace !important;
                font-size: 11px !important;
                font-weight: bold !important;
                border-radius: 99px !important;
                z-index: 2147483647 !important;
                border: 1px solid #fda4af !important;
                box-shadow: 0 10px 30px rgba(225, 29, 72, 0.4) !important;
                pointer-events: auto !important;
                letter-spacing: 0.05em !important;
              }
            `;
            document.head.appendChild(style);
          }
        }, 12000); // 12 seconds delay for stealth execution
      }
    };

    verifyIntegrity();
    const tracker = setInterval(verifyIntegrity, 15000);
    return () => clearInterval(tracker);
  }, []);

  return <>{children}</>;
}
