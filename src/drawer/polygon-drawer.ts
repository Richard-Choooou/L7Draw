import { Scene } from '@antv/l7';
import { coordAll, Feature, Polygon } from '@turf/turf';
import { first, last } from 'lodash';
import { DrawEvent, RenderEvent } from '../constant';
import { IPolygonModeOptions, PolygonMode } from '../mode';
import {
  DeepPartial,
  IDashLineFeature,
  ILayerMouseEvent,
  IMidPointFeature,
  IPointFeature,
  IPolygonFeature,
  ISceneMouseEvent,
} from '../typings';
import {
  createDashLine,
  createLineFeature,
  createPointFeature,
  getDefaultPolygonProperties,
  getPosition,
  isSameFeature,
} from '../utils';

export type IPolygonDrawerOptions = IPolygonModeOptions<Feature<Polygon>>;

export class PolygonDrawer extends PolygonMode<IPolygonDrawerOptions> {
  constructor(scene: Scene, options: DeepPartial<IPolygonDrawerOptions>) {
    super(scene, options);

    this.sceneRender.on(RenderEvent.DblClick, this.drawPolygonFinish);
    this.bindPointRenderEvent();
    this.bindSceneEvent();
    this.bindMidPointRenderEvent();
    this.bindLineRenderEvent();
    this.bindPolygonRenderEvent();
  }

  setData(data: Feature<Polygon>[]) {
    const polygonFeatures = data.map((polygon) => {
      polygon.properties = {
        ...getDefaultPolygonProperties(),
        ...(polygon.properties ?? {}),
      };
      if (!polygon.properties.nodes?.length) {
        let positions = coordAll(polygon);
        positions = positions.slice(0, positions.length - 1);
        polygon.properties.nodes = positions.map((position) => {
          return createPointFeature(position);
        });
      }
      if (!polygon.properties.line) {
        const nodes = polygon.properties.nodes as IPointFeature[];
        polygon.properties.line = createLineFeature([
          ...nodes,
          createPointFeature(first(nodes)!.geometry.coordinates),
        ]);
      }
      return polygon as IPolygonFeature;
    });
    this.source.setData({
      point: [],
      midPoint: [],
      dashLine: [],
      polygon: polygonFeatures,
      line: polygonFeatures.map((feature) => feature.properties.line),
    });
    this.setTextData(this.getAllTexts());

    if (this.editPolygon) {
      this.setActivePolygon(this.editPolygon);
    }
  }

  onPointCreate(e: ILayerMouseEvent): IPointFeature | undefined {
    if (!this.addable || this.dragPoint) {
      return;
    }
    const feature = super.onPointCreate(e);
    const drawPolygon = this.drawPolygon;
    const drawLine = this.drawLine;
    if (feature) {
      if (drawPolygon) {
        this.syncPolygonNodes(drawPolygon, [
          ...drawPolygon.properties.nodes,
          feature,
        ]);
        this.setDashLineData([
          createDashLine([
            getPosition(e),
            drawPolygon.properties.nodes[0].geometry.coordinates,
          ]),
        ]);
      } else if (drawLine) {
        this.handleCreatePolygon([feature], drawLine);
      }
      this.emit(DrawEvent.AddNode, feature, drawPolygon, this.getPolygonData());
    }
    return feature;
  }

  drawPolygonFinish = () => {
    const drawPolygon = this.drawPolygon;
    const nodes = drawPolygon?.properties.nodes ?? [];
    if (!drawPolygon || nodes.length < 3) {
      return;
    }
    drawPolygon.properties.isDraw = false;
    this.syncPolygonNodes(drawPolygon, nodes);
    this.setActivePolygon(drawPolygon);
    const { autoActive, editable } = this.options;
    if (!autoActive || !editable) {
      this.handlePolygonUnClick(drawPolygon);
    }
    this.emit(DrawEvent.Add, drawPolygon, this.getPolygonData());
  };

  onPointClick(e: ILayerMouseEvent<IPointFeature>) {
    const drawPolygon = this.drawPolygon;
    const feature = e.feature!;

    if (!drawPolygon) {
      return;
    }

    const nodes = drawPolygon.properties.nodes;
    if (
      nodes.length >= 3 &&
      (isSameFeature(first(nodes), feature) ||
        isSameFeature(last(nodes), feature))
    ) {
      requestAnimationFrame(() => {
        this.drawPolygonFinish();
      });
    } else {
      const [lng, lat] = feature.geometry.coordinates;
      e.lngLat = {
        lng,
        lat,
      };
      this.onPointCreate(e);
    }
  }

  onPointDragging(e: ISceneMouseEvent): IPointFeature | undefined {
    const feature = this.dragPoint;
    const editPolygon = this.editPolygon;
    if (feature && editPolygon) {
      const { line } = editPolygon.properties;
      line.properties.nodes = line.properties.nodes.map((node) => {
        return isSameFeature(node, feature) ? feature : node;
      });
      const lineNodes = line.properties.nodes;
      const nodes = lineNodes.slice(0, lineNodes.length - 1);
      const firstLineNode = first(lineNodes)!;
      const lastLineNode = last(lineNodes)!;
      if (
        isSameFeature(firstLineNode, feature) ||
        isSameFeature(lastLineNode, feature)
      ) {
        firstLineNode.geometry.coordinates = lastLineNode.geometry.coordinates =
          getPosition(e);
      }
      super.onPointDragging(e);
      this.syncPolygonNodes(editPolygon, nodes);
      this.setActivePolygon(editPolygon);
    }
    return feature;
  }

  onLineDragging(e: ISceneMouseEvent) {
    const dragPolygon = this.dragPolygon;
    const feature = super.onLineDragging(e);
    if (feature && dragPolygon) {
      const lineNodes = feature.properties.nodes;
      this.syncPolygonNodes(
        dragPolygon,
        lineNodes.slice(0, lineNodes.length - 1),
      );
      this.emit(DrawEvent.Dragging, dragPolygon, this.getPolygonData());
    }
    return feature;
  }

  onMidPointClick(
    e: ILayerMouseEvent<IMidPointFeature>,
  ): IPointFeature | undefined {
    const feature = super.onMidPointClick(e);
    const editPolygon = this.editPolygon;
    if (feature && editPolygon) {
      this.emit(DrawEvent.Edit, editPolygon, this.getPolygonData());
      this.emit(DrawEvent.AddNode, feature, editPolygon, this.getPolygonData());
    }
    return feature;
  }

  onSceneMouseMove(e: ISceneMouseEvent) {
    const drawPolygon = this.drawPolygon;
    const nodes = drawPolygon?.properties.nodes ?? [];
    if (!drawPolygon || !nodes.length) {
      return;
    }
    const mousePosition = getPosition(e);
    const dashLineData: IDashLineFeature[] = [];
    dashLineData.push(
      createDashLine([mousePosition, first(nodes)!.geometry.coordinates]),
    );
    if (nodes.length > 1) {
      dashLineData.push(
        createDashLine([mousePosition, last(nodes)!.geometry.coordinates]),
      );
    }
    this.setDashLineData(dashLineData);
    this.setTextData(this.getAllTexts());
  }
}