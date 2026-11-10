declare module "qrcode/lib/core/qrcode.js" {
  type QrModules = {
    size: number;
    get(x: number, y: number): boolean;
  };

  const qrcodeCore: {
    create(
      text: string,
      options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
    ): { modules: QrModules };
  };

  export default qrcodeCore;
}
