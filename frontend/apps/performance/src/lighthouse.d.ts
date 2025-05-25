declare module 'lighthouse' {
  export default function lighthouse(
    url: string,
    options?: any,
    config?: any
  ): Promise<any>;
} 