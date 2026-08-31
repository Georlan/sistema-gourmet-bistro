import type { TableOrderContext as Context } from "../../domain/tableReadModel";

/** Same persisted facts in cards and details, without actions or financial calculations. */
export function TableOrderContext({ context }: { context: Context }) {
  const labels = context.launches.flatMap((launch) =>
    launch.displayNumber ? [launch.displayNumber] : [],
  );
  const missing = context.launches.filter(
    (launch) => !launch.displayNumber,
  ).length;
  const identityNotes = [
    ...labels,
    ...(missing ? [`${missing} sem identificação`] : []),
    ...(context.hasUnidentifiedItems ? ["itens sem vínculo de pedido"] : []),
  ];
  return (
    <dl
      aria-label="Contexto da mesa"
      className="space-y-1 break-words text-[10px] leading-relaxed text-koma-secondary"
    >
      <div>
        <dt className="inline font-semibold">Comandas: </dt>
        <dd className="inline">
          {context.checkCount}
          {context.checkNumbers.length > 0 &&
            ` · ${context.checkNumbers.map((number) => "#" + number).join(" + ")}`}
        </dd>
      </div>
      <div>
        <dt className="inline font-semibold">Pedidos: </dt>
        <dd className="inline">
          {identityNotes.join(" · ") || "Nenhum lançamento identificado"}
        </dd>
      </div>
      <div>
        <dt className="inline font-semibold">Atendentes registrados: </dt>
        <dd className="inline">
          {context.attendants.join(", ") || "Não informado"}
        </dd>
      </div>
    </dl>
  );
}
