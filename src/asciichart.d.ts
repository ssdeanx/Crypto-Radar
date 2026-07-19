declare module 'asciichart' {
  const asciichart: {
    plot(series: number[] | number[][], opts?: {
      height?: number;
      format?: string;
      colors?: number[];
      [key: string]: unknown;
    }): string;
    black: number;
    red: number;
    green: number;
    yellow: number;
    blue: number;
    magenta: number;
    cyan: number;
    lightgray: number;
    default: number;
    darkgray: number;
    lightred: number;
    lightgreen: number;
    lightyellow: number;
    lightblue: number;
    lightmagenta: number;
    lightcyan: number;
    white: number;
    reset: number;
  };
  export default asciichart;
}
