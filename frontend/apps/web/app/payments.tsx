export async function sendWeblnPayment(invoice: string) {
  // @ts-ignore
  if (typeof window.webln !== "undefined") {
    // @ts-ignore

    await window.webln.enable();
    // @ts-ignore
    return await window.webln.sendPayment(invoice);
  }
}
