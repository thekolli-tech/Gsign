<<<<<<< HEAD
# GSIGN — Enterprise Digital Agreement & E-Signature Platform
> **Product Owner**: Genemax IT Solution Private Limited  
> **Brand**: GSIGN (Powered by Genemax Sign)  
> **Platform**: Multi-Tenant SaaS with White-Label Architecture & Cryptographic Audit Integrity  
> **Design Direction**: Clean, minimal, premium 2D enterprise SaaS interface (inspired by Linear, Stripe, DocuSign, Vercel)

---

## 🌟 Visual Design Direction

GSIGN features a refined, distraction-free **2D enterprise interface**:
- **Generous Whitespace & Structured Layouts**: Clean cards with subtle borders (`border-slate-200 dark:border-slate-800`) and soft shadows.
- **Premium Typography**: Built with **Inter** for high legibility, clean tabular figures, and consistent hierarchy across headers, data tables, and forms.
- **Zero Gimmicks / Zero Clutter**: All 3D canvases, holographic rotating objects, floating particles, and excessive animations have been completely removed in favor of a mature, production-ready product aesthetic.
- **Distraction-Free Recipient Signing**: An uncluttered, intuitive 3-step signing workflow focused purely on reading clarity, identity verification, and smooth electronic signing.

---

## 🌓 Light & Dark Theme System

A dedicated **Light / Dark Mode Toggle** is built into the header with immediate visual response and keyboard shortcut (`Ctrl + J` / `Cmd + J`):

- **Light Mode**:
  - Background: Clean light slate (`#f8fafc`)
  - Surfaces: Pure white (`#ffffff`) with subtle 1px border dividers
  - Text: Deep navy / slate (`#0f172a`, `#334155`)
  - Accents: Signature royal blue (`#2563eb`)
- **Dark Mode**:
  - Background: Deep slate (`#020617` / `#0f172a`)
  - Surfaces: Slate-900 (`#0f172a`) with subtle borders (`#1e293b`)
  - Text: Crisp slate whites (`#f8fafc`, `#e2e8f0`, `#94a3b8`)
  - Accents: Restrained brand blue (`#3b82f6` / `#2563eb`)

---

## 🚀 Key Modules & Functional Workflows

All product features from the Genemax Sign technical specification and UI mockups are fully preserved and functional:

1. **Dashboard**
   - 5 KPI summary cards: **Draft: 8**, **Sent: 14**, **Pending signature: 21**, **Completed: 62**, **Expired/Rejected: 5**.
   - Clean recent agreements ledger with status badges and quick actions.
2. **Agreements Ledger**
   - Filter by Status (Completed, Awaiting OTP, Awaiting signature, Expired, Rejected, Cancelled).
   - Filter by Document Type (Offer Letter, NDA, Vendor Agreement, Franchise Agreement, Service Contract).
   - Filter by Department (HR, Legal, Ops, Sales).
   - One-click CSV export with full cryptographic hash logs.
   - `+ New agreement` creator modal.
3. **Agreement Details & Audit Trail**
   - Agreement preview sheet (`AGR-2026-0412`, Ravi Kumar, ₹45,000).
   - Immutable chronological vertical audit trail (Created, Sent, Opened, OTP Verified, Consent Recorded, Signed, PDF Generated).
   - Client-side PDF generation & export via jsPDF.
   - Hash validation tool.
4. **Employment Offer Letter Template Builder**
   - 3-column builder: **FIELDS** palette, dynamic document canvas with `{{token}}` bindings, and **FIELD PROPERTIES** inspector.
   - Live **"Preview with test data"** toggle hot-swapping mock recipient values.
   - **"Publish version"** (publishes Draft v3 to v4).
5. **Documents & Receipts**
   - Receipts ledger (`RCT-0091`, `RCT-0090`, unconfirmed rows).
   - `Acknowledge payment` modal generating verified payment tokens.
   - Official receipt voucher card with amount in figures and words (*"Forty-five thousand rupees only"*).
6. **Team & Roles**
   - Team member list (`Priya N Admin`, `Karan S`, `Asha M`, `Vikram R`).
   - `+ Invite user` modal with role and department assignments.
   - Deactivate / Activate toggles.
7. **Branding & Custom Domain**
   - Logo name customization.
   - Brand color swatches + custom color picker (dynamically sets the platform accent color).
   - Custom domain CNAME DNS validation simulator.
   - Enterprise white-label toggle to remove `"Powered by Genemax Sign"`.
   - Live preview of recipient email invitation.
8. **Subscription & Quota Tracking**
   - Plan tier selector: **Starter (₹499/mo)**, **Business (₹1,499/mo)**, **Professional (₹2,999/mo)**, **Enterprise (Custom)**.
   - Real-time progress meters: Documents (62/100), Users (4/5), Storage (3/10 GB).
9. **Super Admin Console (GENEMAX SIGN)**
   - Context switch between Tenant Admin and Super Admin (Sunil G).
   - Customer Tenants table with company, plan, status, docs count, and domain.
   - `Plans & Pricing` no-code matrix allowing direct inline editing of prices, allowances, and overage rules.
10. **Signatory Demo Portal (3-Step Signing Experience)**
    - **Step 1 (Verification)**: 6-digit OTP boxes with auto-advance, sample OTP autofill (`482190`), and 30s resend timer.
    - **Step 2 (Review & Sign)**: Clean agreement preview, 2D HTML5 `<canvas>` signature drawing pad, clear action, and legal electronic consent checkbox.
    - **Step 3 (Completion)**: Clean confirmation checkmark, reference ID, and signed PDF download.
11. **Sign-In & MFA**
    - Work email, password, and 2-step administrator MFA authentication.

---

## 💻 Tech Stack
- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS (Clean 2D enterprise layout, custom palette, soft shadows)
- **Typography**: Inter (Google Fonts)
- **Icons**: Lucide React
- **Document Generation**: jsPDF

---

## 🏃‍♂️ Getting Started

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build and preview production release
npm run build
npm run preview
```
Visit `http://localhost:4173/` in your browser.
=======
# Gsign
Multi-tenant SaaS digital agreement and e-signature platform (Next.js/React/TS, NestJS, PostgreSQL, Redis/BullMQ) for templates, secure signing links, basic e-signatures and verified eSign/DSC workflows, PDFs, payment receipts, audit logs, and tenant isolation.
>>>>>>> bcf6ae7297205596633980b7e597e72a31f817b3
