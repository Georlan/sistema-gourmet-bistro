import { useLayoutEffect, useState, type RefObject } from 'react';

export type NormalizedPoint = readonly [x: number, y: number];

function solveLinearSystem(matrix: number[][], values: number[]) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }

    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-10) return null;

    for (let value = column; value <= size; value += 1) augmented[column][value] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let value = column; value <= size; value += 1) {
        augmented[row][value] -= factor * augmented[column][value];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function createMatrix3d(
  sourceWidth: number,
  sourceHeight: number,
  destination: readonly NormalizedPoint[],
  stageWidth: number,
  stageHeight: number,
) {
  const source = [
    [0, 0],
    [sourceWidth, 0],
    [sourceWidth, sourceHeight],
    [0, sourceHeight],
  ];
  const target = destination.map(([x, y]) => [x * stageWidth, y * stageHeight]);
  const matrix: number[][] = [];
  const values: number[] = [];

  source.forEach(([x, y], index) => {
    const [u, v] = target[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  });

  const solution = solveLinearSystem(matrix, values);
  if (!solution) return null;
  const [a, b, c, d, e, f, g, h] = solution;

  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,1)`;
}

export function usePerspectiveTransform(
  stageRef: RefObject<HTMLDivElement | null>,
  sourceWidth: number,
  sourceHeight: number,
  destination: readonly NormalizedPoint[],
) {
  const [transform, setTransform] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = () => {
      setTransform(createMatrix3d(
        sourceWidth,
        sourceHeight,
        destination,
        stage.clientWidth,
        stage.clientHeight,
      ));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [destination, sourceHeight, sourceWidth, stageRef]);

  return transform;
}
