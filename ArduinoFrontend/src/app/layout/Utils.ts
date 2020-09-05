import { Line, Point, Block, Canvas, Orientation, CanvasUtils, Path, MathHelper, CanvasElement, OrientationUtil } from './Components';
import _ from 'lodash';
// const _ = require('lodash');

// Minimum unit distance to use in resolving the paths
const DELTA_DISTANCE = 10;

// Path priority map.
// Moving in the same direction is the most prior while searching for the optimal path.
const PATH_PRIORITY = {
    0: 0,
    90: 1,
    270: 2,
    180: 3
};

export class Utils {
    static areLinesSuperimposing(line1: Line, line2: Line) {
        return line1.doesLineSuperimpose(line2);
    }

    private static getDirectPaths(src: Point, dest: Point): Path[] {
        if (CanvasUtils.arePointsAligned(src, dest)) {
            return [new Path([src, dest])];
        }
        const point1 = new Point(src.getX(), dest.getY());
        const point2 = new Point(dest.getX(), src.getY());

        return [new Path([src, point1, dest]), new Path([src, point2, dest])];
    }

    /**
     * Checks if there's an obstacle between the source and destination 2-turn path
     * Returns true/false with the line on the path which is facing obstacle and the element which is the blocker
     * @param path path
     * @param canvas canvas element
     */
    static checkObstacles(path: Path, canvas: Canvas): [boolean, Line, CanvasElement] {
        for (const element of canvas.getElements()) {
            const boundary = CanvasUtils.getBoundary(element);
            const [isSuperImpose, lineSuperImposing, line] = path.doesPathSuperimpose(boundary);
            if (isSuperImpose) {
                return [true, lineSuperImposing, element];
            }
            if (element instanceof Block) {
                const [isIntersect, pathLine, blockLine] = CanvasUtils.doElementsIntersect(element, path);
                if (isIntersect) {
                    return [true, pathLine, element];
                }
            }
        }

        return [false, null, null];
    }

    static getIntermediaryLines(point1: Point, point2: Point, canvas: Canvas, isHorizontal: boolean): [Line[], boolean] {
        const result = [];
        const block = new Block(point1, point2);
        const [minX, maxX, minY, maxY] = [block.getMinX(), block.getMaxX(), block.getMinY(), block.getMaxY()];
        const subCanvas = CanvasUtils.getSubCanvasIntersectingCanvas(canvas, new Block(point1, point2));

        const tryHorizontal = () => {
            // console.log('Trying horizontal lines..');
            const srcLine = new Line(point1, new Point(point1.getX(), point2.getY()));
            const destLine = new Line(point2, new Point(point2.getX(), point1.getY()));
            const tryYRange = (yMin: number, yMax: number) => {
                for (const y of _.range(yMin, yMax, DELTA_DISTANCE)) {
                    const line = new Line(new Point(minX, y), new Point(maxX, y));
                    const pathToCheck  = Path.loadFromLine(line);

                    const [isObstacle, obstacleLine, canvasEl] = Utils.checkObstacles(pathToCheck, subCanvas);

                    if (!isObstacle) {
                        result.push(line);
                        continue;
                    }

                    if (canvasEl instanceof Block) {
                        let [isIntersect, dummy1, dummy2] = CanvasUtils.doElementsIntersect(canvasEl, destLine);
                        if (isIntersect) {
                            result.splice(0, result.length);
                            continue;
                        }
                        [isIntersect, dummy1, dummy2] = CanvasUtils.doElementsIntersect(canvasEl, srcLine);
                        if (isIntersect) {
                            break;
                        }
                    }
                }
            };
            tryYRange(minY + DELTA_DISTANCE, maxY);
            let trials = 1;
            let [prevMin, prevMax] = [minY, maxY + DELTA_DISTANCE];
            while (result.length === 0 && trials < 10) {
                // console.log('Trying horizontal lines.. with trials, ', trials);
                const currMin = prevMin - trials * DELTA_DISTANCE;
                const currMax = prevMax + trials * DELTA_DISTANCE;
                tryYRange(currMin, prevMin);
                if (result.length > 0) {
                    break;
                }
                tryYRange(prevMax, currMax);
                [prevMin, prevMax] = [currMin, currMax];
                trials++;
            }
        };

        const tryVertical = () => {
            const srcLine = new Line(point1, new Point(point2.getX(), point1.getY()));
            const destLine = new Line(point2, new Point(point1.getX(), point2.getY()));
            const tryXRange = (xMin: number, xMax: number) => {
                for (const x of _.range(xMin, xMax, DELTA_DISTANCE)) {
                    const line = new Line(new Point(x, minY), new Point(x, maxY));
                    const pathToCheck  = Path.loadFromLine(line);
                    const [isObstacle, obstacleLine, canvasEl] = Utils.checkObstacles(pathToCheck, subCanvas);

                    if (!isObstacle) {
                        result.push(line);
                        continue;
                    }

                    if (canvasEl instanceof Block) {
                        let [isIntersect, dummy1, dummy2] = CanvasUtils.doElementsIntersect(canvasEl, destLine);
                        if (isIntersect) {
                            result.splice(0, result.length);
                            continue;
                        }
                        [isIntersect, dummy1, dummy2] = CanvasUtils.doElementsIntersect(canvasEl, srcLine);
                        if (isIntersect) {
                            break;
                        }
                    }
                }
            };

            tryXRange(minX + DELTA_DISTANCE, maxX);
            let trials = 1;
            let [prevMin, prevMax] = [minX, maxX + DELTA_DISTANCE];
            while (result.length === 0 && trials < 10) {
                const currMin = prevMin - trials * DELTA_DISTANCE;
                const currMax = prevMax + trials * DELTA_DISTANCE;
                tryXRange(currMin, prevMin);
                if (result.length > 0) {
                    break;
                }
                tryXRange(prevMax, currMax);
                [prevMin, prevMax] = [currMin, currMax];
                trials++;
            }
        };

        const trySequence = isHorizontal ? [tryHorizontal, tryVertical] : [tryVertical, tryHorizontal];

        trySequence[0]();
        if (result.length === 0) {
            trySequence[1]();
        }

        return [result, isHorizontal];
    }

    static chooseLine(lineList: Line[], isOrientationHorizontal: boolean): Line {
        // split into ranges
        const getProperty = isOrientationHorizontal ? Point.prototype.getY : Point.prototype.getX;

        const ranges: Line[][] = [];

        let currLine: Line;
        let currProperty: number;

        let prevLine = lineList[0];
        let prevProperty = getProperty.call(prevLine.getPoint1());
        let row: Line[] = [];

        for (let i = 1; i < lineList.length;) {
            row = [prevLine];
            while (i < lineList.length) {
                currLine = lineList[i];
                currProperty = getProperty.call(currLine.getPoint1());
                prevLine = currLine;
                i++;

                if (MathHelper.areNumbersClose(currProperty, prevProperty + DELTA_DISTANCE)) {
                    row.push(currLine);
                    prevProperty = currProperty;
                } else {
                    ranges.push(row);
                    prevProperty = currProperty;
                    break;
                }

            }
        }
        ranges.push(row);

        // choose the widest range
        const widestRange = _.maxBy(ranges, range => range.length);
        return widestRange[Math.floor(widestRange.length / 2)];
    }

    static getPointAwayFromPort(point: Point, parentBlock: Block, canvas: Canvas): Point {
        let result = parentBlock.getPointAwayFromPort(point, DELTA_DISTANCE);
        while (CanvasUtils.doesPointLieOnCanvaspath(canvas, result)) {
            result = parentBlock.getPointAwayFromPort(result, DELTA_DISTANCE);
        }
        return result;
    }

    static getOptimalPath(src: Point, dest: Point, srcParentBlock: Block, destParentBlock: Block, canvas: Canvas): Path {
        const srcPoint = Utils.getPointAwayFromPort(src, srcParentBlock, canvas);
        const destPoint = Utils.getPointAwayFromPort(dest, destParentBlock, canvas);

        const srcOrientation = srcParentBlock.getRelativeOrientation(src);
        const destOrientation = destParentBlock.getRelativeOrientation(dest);

        const dpDict = {};

        let middlePath = Utils.getOptimalPathRecursive(srcPoint, destPoint, srcOrientation, destOrientation, canvas, dpDict);
        if (!middlePath) {
            // try with destinatino as source.
            middlePath = Utils.getOptimalPathRecursive(destPoint, srcPoint, destOrientation, srcOrientation, canvas, dpDict);
            middlePath = middlePath.reverse();
            if (!middlePath) {
                return null;
            }
        }
        return new Path([src, ...middlePath.getAllPoints(), dest]).simplify();
    }

    static getOptimalPathRecursive(src: Point, dest: Point, srcOrientation: Orientation,
                                   destOrientation: Orientation, canvas: Canvas, dpDict: {[key: string]: Path} = {},
                                   nRecursions: number = 20): Path {
        // console.log("Recursion number: ", nRecursions);
        const directPaths = Utils.getDirectPaths(src, dest);
        directPaths.sort((path1, path2) => {
            const orientation1 = path1.getFirstVectorOrientation();
            const orientation2 = path2.getFirstVectorOrientation();

            const diff1 = MathHelper.modulo(orientation1 - srcOrientation, 360);
            const diff2 = MathHelper.modulo(orientation2 - srcOrientation, 360);

            return PATH_PRIORITY[diff1] - PATH_PRIORITY[diff2];
        });

        let lineWithObstacle: Line;
        let isObstacle: boolean;
        let canvasEl: CanvasElement;

        for (const path of directPaths) {
            [isObstacle, lineWithObstacle, canvasEl] = Utils.checkObstacles(path, canvas);
            if (!isObstacle) {
                return path;
            }
        }

        // no simple path found..
        let isObstacleOnHorizontalAxis = lineWithObstacle.isHorizontal();
        let lineList = [];
        [lineList, isObstacleOnHorizontalAxis] = Utils.getIntermediaryLines(src, dest, canvas, isObstacleOnHorizontalAxis);

        // if (lineList.length === 0) {
        //     isObstacleOnHorizontalAxis = !isObstacleOnHorizontalAxis;
        //     lineList = Utils.getIntermediaryLines(src, dest, canvas, isObstacleOnHorizontalAxis);
        if (lineList.length === 0) {
            return null;
        }
        // }
        let resultPath: Path;

        const chosenLine = Utils.chooseLine(lineList, isObstacleOnHorizontalAxis);
        if (chosenLine) {
            const [chosenPoint1, chosenPoint2] = chosenLine.getEnds();

            /// TODO: refactor following statements
            if (isObstacleOnHorizontalAxis) {
                if (chosenPoint1.getX() === src.getX()) {
                    resultPath = new Path([src, chosenPoint1, chosenPoint2, dest]);
                } else if (chosenPoint2.getX() === src.getX()) {
                    resultPath = new Path([src, chosenPoint2, chosenPoint1, dest]);
                }
            } else {
                if (chosenPoint1.getY() === src.getY()) {
                    resultPath = new Path([src, chosenPoint1, chosenPoint2, dest]);
                } else if (chosenPoint2.getY() === src.getY()) {
                    resultPath = new Path([src, chosenPoint2, chosenPoint1, dest]);
                }
            }

            if (resultPath) {
                const [areObstacles, obstaclePath, canvasEl1] = Utils.checkObstacles(resultPath, canvas);
                if (!areObstacles) {
                    return resultPath;
                }
            }
        }

        if (nRecursions < 0) {
            // console.log('Max recursions reached.');
            return;
        }

        const srcDestOrientation = dest.subtract(src).getApproxOrientation();
        let directions: Orientation[];

        const deltaOrientation = Math.abs(srcDestOrientation - srcOrientation);

        if (deltaOrientation === 180) {
            directions = [srcOrientation,
                          OrientationUtil.addOrientations(srcDestOrientation, 90),
                          OrientationUtil.subtractOrientations(srcDestOrientation, 90),
                          srcDestOrientation];
        } else if ([90, 270].includes(deltaOrientation)) {
            directions = [srcOrientation,
                          srcDestOrientation,
                          OrientationUtil.addOrientations(srcDestOrientation, 180),
                          OrientationUtil.addOrientations(srcOrientation, 180)];
        } else {
            directions = [
                srcOrientation,
                OrientationUtil.subtractOrientations(srcOrientation, 90),
                OrientationUtil.addOrientations(srcOrientation, 90),
                OrientationUtil.addOrientations(srcOrientation, 180),
            ];
        }
        // directions = directions.filter(dir => dir !== srcOrientation);

        for (const direction of directions) {
            const step = OrientationUtil.getUnitVector(direction).multiply(1 * DELTA_DISTANCE);
            const newSource = Point.loadFromVector(src.getVector().add(step));
            resultPath = new Path([src, newSource]);
            const [isInvalid, dummy1, dummy2] = Utils.checkObstacles(resultPath, canvas);
            if (!isInvalid) {
                const key = `${newSource}:${dest}`;
                if (!dpDict.hasOwnProperty(key)) {
                    dpDict[key] = Utils.getOptimalPathRecursive(newSource, dest, direction, destOrientation, canvas,
                                                                  dpDict, nRecursions - 1);
                }
                const recursivePath = dpDict[key];
                if (recursivePath) {
                    return resultPath.addPath(recursivePath);
                }
            }
            continue;
        }
    }
// }

// function test() {
//     const point1 = new Point(0, 0);
//     let block1 = new Block(new Point(-20, 20), new Point(0, -20));

//     const point2 = new Point(100, 100);
//     let block2 = new Block(new Point(110, 100), new Point(90, 120));

//     const canvas = new Canvas();
//     canvas.addElement(block1);
//     canvas.addElement(block2);

//     // Test 1
//     let path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     // console.log(path);

//     // Test 2
//     canvas.removeElement(block2);
//     block2 = new Block(new Point(100, 80), new Point(120, 120));
//     canvas.addElement(block2);
//     path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     // console.log(path);

//     // Test 3
//     canvas.removeElement(block2);
//     block2 = new Block(new Point(100, 80), new Point(120, 120));
//     canvas.addElement(block2);
//     path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     // console.log(path);

//     // Test 4
//     canvas.removeElement(block2);
//     block2 = new Block(new Point(90, 100), new Point(110, 80));
//     canvas.addElement(block2);
//     path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     // console.log(path);

//     // Test 5
//     canvas.removeElement(block2);
//     block2 = new Block(new Point(100, 120), new Point(80, 80));
//     canvas.addElement(block2);
//     path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     // console.log(path);

//     // Test 5
//     canvas.removeElement(block1);
//     block1 = new Block(new Point(0, 20), new Point(20, -20));
//     canvas.addElement(block1);
//     path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     console.log(path);
// }


// function test2() {
//     const point1 = new Point(168.53, 204);
//     let block1 = new Block(new Point(157.53, 109), new Point(181.53, 209));

//     const point2 = new Point(292, 331);
//     let block2 = new Block(new Point(150, 309), new Point(645, 639));

//     const canvas = new Canvas();
//     canvas.addElement(block1);
//     canvas.addElement(block2);

//     // Test 1
//     let path = Utils.getOptimalPath(point1, point2, block1, block2, canvas);
//     console.log(path);
// }

// test2();
