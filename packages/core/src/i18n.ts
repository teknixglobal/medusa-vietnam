export type Locale = "vi" | "en"

export type Flow = "form_post" | "redirect" | "qr" | "offline"

export const METHOD_INFO: Record<
  string,
  { flow: Flow; label: Record<Locale, string>; description: Record<Locale, string> }
> = {
  sepay: {
    flow: "form_post",
    label: {
      vi: "Chuyển khoản QR / Thẻ (SePay)",
      en: "Bank transfer QR / Card (SePay)",
    },
    description: {
      vi: "Quét mã VietQR bằng app ngân hàng hoặc trả bằng thẻ trên trang SePay.",
      en: "Scan the VietQR code with your banking app or pay by card on the SePay page.",
    },
  },
  vnpay: {
    flow: "redirect",
    label: { vi: "VNPay (QR, ATM, thẻ quốc tế)", en: "VNPay (QR, ATM, international card)" },
    description: {
      vi: "Chuyển sang cổng VNPay để thanh toán.",
      en: "You will be redirected to VNPay to pay.",
    },
  },
  cod: {
    flow: "offline",
    label: { vi: "Thanh toán khi nhận hàng (COD)", en: "Cash on delivery (COD)" },
    description: {
      vi: "Trả tiền mặt cho nhân viên giao hàng.",
      en: "Pay cash to the courier on delivery.",
    },
  },
}

export function pickLocale(value: unknown, fallback: Locale = "vi"): Locale {
  if (typeof value !== "string") {
    return fallback
  }
  const lower = value.toLowerCase()
  if (lower.startsWith("vi")) {
    return "vi"
  }
  if (lower.startsWith("en")) {
    return "en"
  }
  return fallback
}

/** Provider code from a provider id: pp_sepay_sepay -> sepay */
export function codeFromProviderId(providerId: string): string | undefined {
  const match = /^pp_([^_]+)_/.exec(providerId)
  return match?.[1]
}
