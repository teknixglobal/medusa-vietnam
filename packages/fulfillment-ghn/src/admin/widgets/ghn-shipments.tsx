import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types"
import { Button, Container, Select, StatusBadge, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { sdk } from "../lib/sdk"

type GhnFulfillment = {
  id: string
  provider_id: string
  canceled_at?: string | null
  shipped_at?: string | null
  delivered_at?: string | null
  created_at?: string
  data?: Record<string, unknown> | null
}

type BadgeColor = "green" | "blue" | "orange" | "red" | "grey"

const STATUS: Record<string, { label: string; color: BadgeColor }> = {
  pending: { label: "Chờ lấy hàng", color: "orange" },
  picked_up: { label: "Đã lấy hàng", color: "blue" },
  in_transit: { label: "Đang vận chuyển", color: "blue" },
  out_for_delivery: { label: "Đang giao", color: "blue" },
  delivered: { label: "Đã giao", color: "green" },
  delivery_failed: { label: "Giao thất bại", color: "orange" },
  returning: { label: "Đang hoàn về", color: "orange" },
  returned: { label: "Đã hoàn về shop", color: "red" },
  canceled: { label: "GHN đã huỷ", color: "grey" },
  lost: { label: "Mất / hỏng", color: "red" },
  exception: { label: "Ngoại lệ", color: "red" },
  unknown: { label: "Chưa rõ", color: "grey" },
}

const FORMATS = [
  { value: "A5", label: "Khổ A5" },
  { value: "80x80", label: "Nhiệt 80×80" },
  { value: "52x70", label: "Nhiệt 52×70" },
]

const vnd = (value: unknown) =>
  typeof value === "number" ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value) : "—"

const dateTime = (value: unknown) =>
  typeof value === "string" && value && !value.startsWith("0001")
    ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
    : "—"

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-x-4">
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {label}
      </Text>
      <div className="text-right">{children}</div>
    </div>
  )
}

function Shipment({ fulfillment, orderId }: { fulfillment: GhnFulfillment; orderId: string }) {
  const queryClient = useQueryClient()
  const [format, setFormat] = useState("A5")
  const data = fulfillment.data ?? {}
  const code = String(data.ghn_order_code ?? "")
  const status = fulfillment.canceled_at
    ? { label: "Đã huỷ trong Medusa", color: "grey" as BadgeColor }
    : STATUS[String(data.shipment_status ?? "unknown")] ?? STATUS.unknown

  const label = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ url: string }>(`/admin/ghn/fulfillments/${fulfillment.id}/label`, {
        query: { format },
      }),
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener")
    },
    onError: (e: Error) => toast.error(`Không lấy được nhãn GHN: ${e.message}`),
  })

  const sync = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ changed: boolean; reason?: string }>(`/admin/ghn/fulfillments/${fulfillment.id}/sync`, {
        method: "POST",
      }),
    onSuccess: (r) => {
      toast.success(r.changed ? "Đã cập nhật trạng thái từ GHN" : "Trạng thái GHN không đổi")
      queryClient.invalidateQueries({ queryKey: ["ghn-shipments", orderId] })
      queryClient.invalidateQueries({ queryKey: ["orders"] })
    },
    onError: (e: Error) => toast.error(`Không đồng bộ được GHN: ${e.message}`),
  })

  return (
    <div className="flex flex-col gap-y-3 border-t border-ui-border-base px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <a
          href={`https://donhang.ghn.vn/?order_code=${encodeURIComponent(code)}`}
          target="_blank"
          rel="noreferrer"
          className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
        >
          {code}
        </a>
        <StatusBadge color={status.color}>{status.label}</StatusBadge>
      </div>
      {typeof data.shipment_flag === "string" && !fulfillment.canceled_at && (
        <Text size="small" leading="compact" className="text-ui-fg-error">
          Cần xử lý: {STATUS[data.shipment_flag]?.label ?? data.shipment_flag}
          {typeof data.ghn_reason === "string" ? ` · ${data.ghn_reason}` : ""}
        </Text>
      )}
      <div className="flex flex-col gap-y-1.5">
        <Row label="Trạng thái GHN">
          <Text size="small" leading="compact">{String(data.ghn_status ?? "—")}</Text>
        </Row>
        <Row label="Thu hộ (COD)">
          <Text size="small" leading="compact">{vnd(data.ghn_cod_amount)}</Text>
        </Row>
        {typeof data.ghn_insurance_value === "number" && data.ghn_insurance_value > 0 && (
          <Row label="Khai giá (bảo hiểm)">
            <Text size="small" leading="compact">{vnd(data.ghn_insurance_value)}</Text>
          </Row>
        )}
        <Row label="Phí GHN">
          <Text size="small" leading="compact">{vnd(data.ghn_fee)}</Text>
        </Row>
        <Row label="Giao dự kiến">
          <Text size="small" leading="compact">{dateTime(data.ghn_expected_delivery)}</Text>
        </Row>
        <Row label="GHN chuyển COD">
          <Text size="small" leading="compact">{dateTime(data.ghn_cod_transfer_date)}</Text>
        </Row>
        <Row label="Đồng bộ lúc">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {dateTime(data.ghn_synced_at)}
          </Text>
        </Row>
        {data.ghn_env === "staging" && (
          <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
            Môi trường thử (staging)
          </Text>
        )}
      </div>
      {!fulfillment.canceled_at && (
        <div className="flex items-center gap-x-2">
          <div className="w-32">
            <Select size="small" value={format} onValueChange={setFormat}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {FORMATS.map((f) => (
                  <Select.Item key={f.value} value={f.value}>
                    {f.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <Button size="small" variant="secondary" onClick={() => label.mutate()} isLoading={label.isPending} disabled={label.isPending}>
            In nhãn
          </Button>
          <Button size="small" variant="transparent" onClick={() => sync.mutate()} isLoading={sync.isPending} disabled={sync.isPending}>
            Cập nhật
          </Button>
        </div>
      )}
    </div>
  )
}

/** GHN shipments of an order: status, COD, label printing, manual sync. */
const GhnShipmentsWidget = ({ data: order }: DetailWidgetProps<HttpTypes.AdminOrder>) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ghn-shipments", order.id],
    queryFn: () =>
      sdk.admin.order.retrieve(order.id, {
        fields:
          "id,metadata,fulfillments.id,fulfillments.provider_id,fulfillments.data,fulfillments.canceled_at,fulfillments.shipped_at,fulfillments.delivered_at,fulfillments.created_at",
      }),
  })
  const shipments = ((data?.order?.fulfillments ?? []) as unknown as GhnFulfillment[])
    .filter((f) => f.provider_id?.startsWith("ghn_") && f.data?.ghn_order_code)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  if (!isLoading && !isError && !shipments.length) {
    return null
  }
  const codCapture = (data?.order?.metadata as Record<string, unknown> | null | undefined)?.vn_cod_capture as
    | { status?: string; reason?: string; amount?: number; at?: string }
    | undefined

  return (
    <Container className="divide-y-0 p-0">
      <div className="px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Giao hàng GHN
        </Text>
        {codCapture?.status === "captured" && (
          <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
            Đã tự ghi nhận thu COD {vnd(codCapture.amount)} lúc {dateTime(codCapture.at)}
          </Text>
        )}
        {(codCapture?.status === "blocked" || codCapture?.status === "failed") && (
          <Text size="xsmall" leading="compact" className="text-ui-fg-error">
            Chưa tự thu COD ({codCapture.reason ?? codCapture.status}). Kiểm tra với GHN rồi bấm Capture ở mục thanh toán.
          </Text>
        )}
      </div>
      {isLoading && (
        <Text size="small" leading="compact" className="px-6 pb-4 text-ui-fg-subtle">
          Đang tải…
        </Text>
      )}
      {isError && (
        <Text size="small" leading="compact" className="px-6 pb-4 text-ui-fg-error">
          Không tải được vận đơn GHN.
        </Text>
      )}
      {shipments.map((f) => (
        <Shipment key={f.id} fulfillment={f} orderId={order.id} />
      ))}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side",
})

export default GhnShipmentsWidget
