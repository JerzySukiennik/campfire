// Loads the pre-baked textures (see Niepotrzebne/bake) and the 3D noise volume.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();

function tex(name, srgb, repeat, onDone) {
  return new Promise((res, rej) => loader.load(`tex/${name}.webp`, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    onDone();
    res(t);
  }, undefined, rej));
}

async function noiseVolume(N = 64) {
  const r = await fetch('tex/noise.bin');
  const data = new Uint8Array(await r.arrayBuffer());
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export async function loadAssets(progress) {
  const list = [
    ['oak', true, false], ['oak_n', false, false], ['birch', true, false], ['birch_n', false, false],
    ['floor', true, true], ['floor_n', false, true], ['ash', true, true], ['ash_n', false, true],
    ['bark', true, true], ['bark_n', false, true], ['grass', true, false],
  ];
  let done = 0;
  const tick = () => progress(++done / (list.length + 1));
  const [noise, ...ts] = await Promise.all([noiseVolume().then((v) => { tick(); return v; }), ...list.map(([n, s, r]) => tex(n, s, r, tick))]);
  const T = Object.fromEntries(list.map(([n], i) => [n, ts[i]]));
  return {
    noiseTex: noise,
    atlases: { oak: { map: T.oak, normalMap: T.oak_n }, birch: { map: T.birch, normalMap: T.birch_n } },
    floor: { map: T.floor, normalMap: T.floor_n },
    ash: { map: T.ash, normalMap: T.ash_n },
    bark: { map: T.bark, normalMap: T.bark_n },
    grass: T.grass,
  };
}
