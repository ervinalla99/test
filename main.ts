import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import * as BUIC from "@thatopen/ui-obc";
import projectInformation from "./components/Panels/ProjectInformation";
import elementData from "./components/Panels/Selection";
import settings from "./components/Panels/Settings";
import load from "./components/Toolbars/Sections/Import";
import help from "./components/Panels/Help";
import camera from "./components/Toolbars/Sections/Camera";
import selection from "./components/Toolbars/Sections/Selection";
import { AppManager } from "./bim-components";
import Stats from "three/examples/jsm/libs/stats.module.js";
BUI.Manager.init();
BUIC.Manager.init();
const components = new OBC.Components();
const worlds = components.get(OBC.Worlds);

const world = worlds.create<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBF.PostproductionRenderer
>();
world.name = "Main";

world.scene = new OBC.SimpleScene(components);
world.scene.setup();
world.scene.three.background = null;

const viewport = BUI.Component.create<BUI.Viewport>(() => {
  return BUI.html`
    <bim-viewport>
      <bim-grid floating></bim-grid>
    </bim-viewport>
  `;
});

world.renderer = new OBF.PostproductionRenderer(components, viewport);
const { postproduction } = world.renderer;

world.camera = new OBC.OrthoPerspectiveCamera(components);

const worldGrid = components.get(OBC.Grids).create(world);
worldGrid.material.uniforms.uColor.value = new THREE.Color(0x424242);
worldGrid.material.uniforms.uSize1.value = 2;
worldGrid.material.uniforms.uSize2.value = 8;

const resizeWorld = () => {
  world.renderer?.resize();
  world.camera.updateAspect();
};

viewport.addEventListener("resize", resizeWorld);

components.init();

postproduction.enabled = true;
postproduction.customEffects.excludedMeshes.push(worldGrid.three);
postproduction.setPasses({ custom: true, ao: true, gamma: true });
postproduction.customEffects.lineColor = 0x17191c;

const appManager = components.get(AppManager);
const viewportGrid = viewport.querySelector<BUI.Grid>("bim-grid[floating]")!;
appManager.grids.set("viewport", viewportGrid);

const fragments = components.get(OBC.FragmentsManager);
const indexer = components.get(OBC.IfcRelationsIndexer);
const classifier = components.get(OBC.Classifier);
classifier.list.CustomSelections = {};

const ifcLoader = components.get(OBC.IfcLoader);
await ifcLoader.setup();
//local file


const tilesLoader = components.get(OBF.IfcStreamer);
tilesLoader.url = "../resources/tiles/";
tilesLoader.world = world;
tilesLoader.culler.threshold = 10;
tilesLoader.culler.maxHiddenTime = 1000;
tilesLoader.culler.maxLostTime = 40000;

const highlighter = components.get(OBF.Highlighter);
highlighter.setup({ world });
highlighter.zoomToSelection = true;

const culler = components.get(OBC.Cullers).create(world);
culler.threshold = 1;

world.camera.controls.restThreshold = 0.25;
world.camera.controls.addEventListener("rest", () => {
  culler.needsUpdate = true;
  tilesLoader.culler.needsUpdate = true;
});

const file = await fetch("src/road.frag");
const data = await file.arrayBuffer();
const buffer = new Uint8Array(data);
const model = await fragments.load(buffer);
const properties = await fetch("src/road.json");
const props = await properties.json();
model.setLocalProperties(props);
console.log(model);
world.scene.three.add(model);
await indexer.process(model);

for (const fragment of model.items) {
  world.meshes.add(fragment.mesh);
  culler.add(fragment.mesh);
}

fragments.onFragmentsLoaded.add(async (model) => {
  if (model.hasProperties) {
    await indexer.process(model);
    classifier.byEntity(model);
  }

  for (const fragment of model.items) {
    world.meshes.add(fragment.mesh);
    culler.add(fragment.mesh);
  }

  world.scene.three.add(model);
  setTimeout(async () => {
    world.camera.fit(world.meshes, 0.8);
  }, 50);

});

fragments.onFragmentsDisposed.add(({ fragmentIDs }) => {
  for (const fragmentID of fragmentIDs) {
    const mesh = [...world.meshes].find((mesh) => mesh.uuid === fragmentID);
    if (mesh) world.meshes.delete(mesh);
  }
});

const projectInformationPanel = projectInformation(components);
const elementDataPanel = elementData(components);

const navigator = components.get(OBF.Civil3DNavigator);
navigator.world = world;
navigator.draw(model);
const sphere = new THREE.Sphere(undefined, 20);

//Connect point in 3d with cross section 
navigator.onHighlight.add(({ point }) => {
  sphere.center.copy(point);
  world.camera.controls.fitToSphere(sphere, true);
  navigator.onMarkerChange.add(({ alignment, percentage, type, curve }) => {
    if (type === "select") {
      const mesh = curve.alignment.absolute[curve.index].mesh;
      const point = alignment.getPointAt(percentage, "absolute");
      crossNavigator.set(mesh, point);
    }
  })
});
const world2D = document.getElementById("Plan-Nav") as BUIC.World2D;
const planNavigator = components.get(OBF.CivilPlanNavigator);
world2D.components = components;
planNavigator.world = world2D.world;
await planNavigator.draw(model);
const CrossSection = document.getElementById("Cross-Section") as BUIC.World2D;
CrossSection.components = components;

const crossNavigator = components.get(OBF.CivilCrossSectionNavigator);
crossNavigator.world = CrossSection.world;
crossNavigator.world3D = world;

planNavigator.onMarkerChange.add(({ alignment, percentage, type, curve }) => {
  navigator.setMarker(alignment, percentage, type);
  elevationNavigator.setMarker(curve.alignment, percentage, type);
  if (type === "select") {
    const mesh = curve.alignment.absolute[curve.index].mesh;
    const point = alignment.getPointAt(percentage, "absolute");
    crossNavigator.set(mesh, point);
  }
});
planNavigator.onMarkerHidden.add(({ type }) => {
  navigator.hideMarker(type);
});
//const classifier = components.get(OBC.Classifier);
classifier.byEntity(model);
const classifications = classifier.list;
const clipper = components.get(OBF.ClipEdges);
const styles = clipper.styles.list;

for (const category in classifications.entities) {
  const found = classifier.find({ entities: [category] });

  const color = new THREE.Color(Math.random(), Math.random(), Math.random());
  const lineMaterial = new THREE.LineBasicMaterial({ color });
  clipper.styles.create(category, new Set(), CrossSection.world!, lineMaterial);

  for (const fragID in found) {
    const foundFrag = fragments.list.get(fragID);
    if (!foundFrag) {
      continue;
    }
    styles[category].fragments[fragID] = new Set(found[fragID]);
    styles[category].meshes.add(foundFrag.mesh);
  }
}
clipper.update(true);

//Elevation
const Profile = document.getElementById("Profile") as BUIC.World2D;
Profile.components = components;
const elevationNavigator = components.get(OBF.CivilElevationNavigator);
elevationNavigator.world = Profile.world;
await elevationNavigator.draw(model);

planNavigator.onHighlight.add(({ mesh, point }) => {
  const { index, alignment } = mesh.curve;

  const percentage = alignment.getPercentageAt(point, "horizontal");
  if (percentage === null) return;
  const { curve } = alignment.getCurveAt(percentage, "vertical");
  elevationNavigator.highlighter.select(curve.mesh);

  elevationNavigator.setMarker(curve.alignment, percentage, "select");

  if (Profile.world) {
    if (!curve.mesh.geometry.boundingSphere) {
      curve.mesh.geometry.computeBoundingSphere();
    }
    const vertSphere = curve.mesh.geometry.boundingSphere!.clone();
    vertSphere.radius *= 0.9;
    Profile.world.camera.controls.fitToSphere(vertSphere, true);
  }

  navigator.highlighter.select(mesh);
  const curve3d = mesh.curve.alignment.absolute[index];
  curve3d.mesh.geometry.computeBoundingSphere();
  const sphere = curve3d.mesh.geometry.boundingSphere;
  if (sphere) {
    world.camera.controls.fitToSphere(sphere, true);
  }
});
const viewCube = document.createElement("bim-view-cube");
viewCube.camera = world.camera.three;
viewCube.style.position = "absolute";
viewCube.style.top = "5px";
viewCube.style.right = "5px";
viewCube.style.width = "60px";  // Ensure it stays at default width
viewCube.style.height = "60px"; // Ensure it stays at default height
// Set text labels
viewCube.rightText = "Right";
viewCube.leftText = "Left";
viewCube.topText = "Top";
viewCube.bottomText = "Bottom";
viewCube.frontText = "Front";
viewCube.backText = "Back";
viewport.append(viewCube);
world.camera.controls.addEventListener("update", () =>
  viewCube.updateOrientation(),
);
const stats = new Stats();
stats.showPanel(2);

stats.dom.style.left = `26rem`;
stats.dom.style.zIndex = "unset";
viewport.append(stats.dom);
world.renderer.onBeforeUpdate.add(() => stats.begin());
world.renderer.onAfterUpdate.add(() => stats.end());

function addResizeAndResetFunctionality(panelId: string) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const resizeHandle = document.createElement("div");
  resizeHandle.classList.add("resize-handle");
  panel.appendChild(resizeHandle);

  const closeButton = document.createElement("button");
  closeButton.textContent = "-";
  closeButton.classList.add("close-button");
  panel.appendChild(closeButton);

  let isResizing = false;
  let dragStartX: number, dragStartY: number, initialWidth: number, initialHeight: number;

  resizeHandle.addEventListener("mousedown", startResize);
  document.addEventListener("mousemove", resize);
  document.addEventListener("mouseup", stopResize);

  closeButton.addEventListener("click", resetPanel);

  function startResize(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    initialWidth = panel!.offsetWidth;
    initialHeight = panel!.offsetHeight;
  }

  function resize(event: MouseEvent) {
    if (!isResizing) return;

    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    const newWidth = initialWidth + deltaX;
    const newHeight = initialHeight + deltaY;

    panel!.style.width = newWidth + "px";
    panel!.style.height = newHeight + "px";
  }

  function stopResize() {
    isResizing = false;
  }

  function resetPanel() {
    panel!.style.width = "";
    panel!.style.height = "";
    panel!.style.left = "";
    panel!.style.top = "";
  }
}

// Add resize and reset functionality to both "Cross-Section" and "Plan-Nav" panels
addResizeAndResetFunctionality("Cross-Section");
addResizeAndResetFunctionality("Plan-Nav");
addResizeAndResetFunctionality("Profile");

import Drawing from 'dxf-writer';

// Function to export cross-section to DXF
async function exportCrossSectionToDXF(crossNavigator: any) {
  // Initialize the DXF writer
  const drawing = new Drawing();
  drawing.setUnits("Meters");

  // Add a new layer for the cross-section
  const layerName = "cross-section";
  drawing.addLayer(layerName, Drawing.ACI.RED, "CONTINUOUS");
  drawing.setActiveLayer(layerName);

  // Access the edges from the plane
  const edges = crossNavigator.plane.edges.get();

  // Set a precision limit to reduce file size
  const precision = 0.01;

  for (const styleName in edges) {
    const mesh = edges[styleName].mesh;
    const geometry = mesh.geometry;

    if (geometry.isBufferGeometry) {
      const positionArray = geometry.attributes.position.array;

      // Iterate through the position array and add lines to the DXF drawing
      for (let i = 0; i < positionArray.length; i += 6) {
        const x1 = parseFloat(positionArray[i].toFixed(2));
        const y1 = parseFloat(positionArray[i + 1].toFixed(2));
        const x2 = parseFloat(positionArray[i + 3].toFixed(2));
        const y2 = parseFloat(positionArray[i + 4].toFixed(2));

        // Filter out very small lines
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (Math.abs(dx) < precision && Math.abs(dy) < precision) continue;

        // Add lines to the DXF drawing
        drawing.drawLine(x1, y1, x2, y2);
      }
    }
  }

  // Generate the DXF string
  const dxfString = drawing.toDxfString();

  // Save the DXF string to a file (in a browser environment)
  const blob = new Blob([dxfString], { type: 'application/dxf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'cross-section.dxf';
  link.click();
}
const hider = components.get(OBC.Hider)
function Isolate() {
  const selection = highlighter.selection.select
  if (Object.keys(selection).length === 0) return;
  for (const [, fragment] of fragments.list) {
    fragment.setVisibility(false);
  }
  hider.set(true, selection)
}
function ShowAll() {
  for (const [, fragment] of fragments.list)
    fragment.setVisibility(true);
}

document.getElementById('isolateButton')?.addEventListener('click', Isolate);
document.getElementById('showAllButton')?.addEventListener('click', ShowAll);

// The chatbot part interaction with the viewer
const exportButton = document.createElement('button');
exportButton.innerText = 'Export Cross Section to DXF';
exportButton.onclick = () => exportCrossSectionToDXF(crossNavigator);
const eventSource = new EventSource('/events');
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  console.log('Received message from server:', data.message);

  // Handle the response data here
  switch (data.action) {
    case 'Action1':
      exportButton.click();
      break;
    case 'Isolate':
      Isolate();
      break;
    case 'ShowAll':
      ShowAll();
      break;
    default:
      console.log('Unknown action:', data.action);
  }
});

eventSource.addEventListener('error', (error) => {
  console.error('EventSource error:', error);
});

const toolbar = BUI.Component.create(() => {
  const showElement = (element: HTMLElement) => {
    if (element.classList.contains('visible')) {
      element.classList.remove('visible');
      element.classList.add('hidden');
    } else {
      element.classList.remove('hidden');
      element.classList.add('visible');
    }
  };

  return BUI.html`
    <bim-toolbar>
      ${load(components)}
      ${camera(world)}
      ${selection(components, world)}
      <bim-toolbar-section label="Alignments">
        <bim-button label="Horizontal" @click=${() => showElement(document.getElementById("Plan-Nav") as HTMLElement)} tooltip-title="Horizontal Alignment" tooltip-text="Open/Close the horizontal alignment panel."></bim-button>
        <bim-button label="Profile" @click=${() => showElement(document.getElementById("Profile") as HTMLElement)} tooltip-title="Alignment Profile" tooltip-text="Open/Close the Profile panel."></bim-button>
        <bim-button label="Cross Section" @click=${() => showElement(document.getElementById("Cross-Section") as HTMLElement)} tooltip-title="Cross Section" tooltip-text="Open/Close the Cross Section panel."></bim-button>
      </bim-toolbar-section>
    </bim-toolbar>
  `;
});

const leftPanel = BUI.Component.create(() => {
  return BUI.html`
    <bim-tabs switchers-full>
      <bim-tab name="project" label="Project" icon="ph:building-fill">
        ${projectInformationPanel}
      </bim-tab>
      <bim-tab name="settings" label="Settings" icon="solar:settings-bold">
        ${settings(components)}
      </bim-tab>
      <bim-tab name="help" label="Help" icon="material-symbols:help">
        ${help}
      </bim-tab>
    </bim-tabs> 
  `;
});
const app = document.getElementById("app") as BUI.Grid;
app.layouts = {
  main: {
    template: `
      "leftPanel viewport" 1fr
      /minmax(180px, 24vw) 1fr
    `,
    elements: {
      leftPanel,
      viewport,
    },
  },
  small: {
    template: `
      "leftPanel viewport" 1fr
      /minmax(80px, 16vw) 1fr
    `,
    elements: {
      leftPanel,
      viewport,
    },
  },
};

function updateAppLayout() {
  if (window.innerWidth <= 1366) {
    app.layout = "small";
  } else {
    app.layout = "main";
  }
}
window.addEventListener("resize", updateAppLayout);
updateAppLayout();

viewportGrid.layouts = {
  main: {
    template: `
      "empty" 1fr
      "toolbar" auto
      /1fr
    `,
    elements: { toolbar },
  },
  second: {
    template: `
      "empty elementDataPanel" 1fr
      "toolbar elementDataPanel" auto
      /1fr minmax(120px, 22vw)
    `,
    elements: {
      toolbar,
      elementDataPanel,
    },
  },
  smallSecond: {
    template: `
      "empty elementDataPanel" 1fr
      "toolbar elementDataPanel" auto
      /1fr minmax(60px, 14vw)
    `,
    elements: {
      toolbar,
      elementDataPanel,
    },
  },
};

function updateViewportGridLayout() {
  if (window.innerWidth <= 1366) {
    viewportGrid.layout = "main";
    if (viewportGrid.layout === "second") {
      viewportGrid.layout = "smallSecond";
    }
  } else {
    viewportGrid.layout = "main";
  }
}
window.addEventListener("resize", updateViewportGridLayout);
updateViewportGridLayout();
