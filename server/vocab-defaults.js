/** Default option lists for article metadata (editable in reader). */
const { normalizeProfile } = require("../shared/method-profiles");

const methodCatalogSeed = [
  {
    label: "Kilosort",
    modalities: ["SPIKE"],
    category: "RAW",
    triggers: {
      direct: ["Kilosort", "Kilosort2", "Kilosort 2.5", "KS"],
      indirect: ["spike sorting", "automatic sorting"],
      combination: [],
    },
  },
  {
    label: "Klustakwik",
    modalities: ["SPIKE"],
    category: "RAW",
    triggers: {
      direct: ["Klustakwik", "KlustaKwik"],
      indirect: ["klustakwik"],
      combination: [],
    },
  },
  {
    label: "manual clustering",
    modalities: ["SPIKE"],
    category: "RAW",
    triggers: {
      direct: ["manual clustering", "manual sort"],
      indirect: ["hand sorting", "manual curation"],
      combination: [],
    },
  },
  {
    label: "GLM",
    modalities: ["SPIKE", "BEH"],
    category: "RELATIONAL",
    triggers: {
      direct: ["GLM"],
      indirect: ["generalized linear model"],
      combination: [],
    },
  },
  {
    label: "decoding",
    modalities: ["SPIKE", "BEH"],
    category: "TASK",
    triggers: {
      direct: ["decoding", "decoder"],
      indirect: ["decoding analysis"],
      combination: [],
    },
  },
  {
    label: "rate map",
    modalities: ["SPIKE", "BEH"],
    category: "SPATIAL",
    triggers: {
      direct: ["rate map", "rate maps"],
      indirect: ["firing rate map"],
      combination: [],
    },
  },
  {
    label: "place field detection",
    modalities: ["SPIKE", "BEH"],
    category: "SPATIAL",
    triggers: {
      direct: ["place field", "place fields"],
      indirect: ["place cell detection"],
      combination: [],
    },
  },
  {
    label: "ripple detection",
    modalities: ["LFP"],
    category: "EVENT",
    triggers: {
      direct: ["ripple detection", "SWR"],
      indirect: ["sharp-wave ripple"],
      combination: [],
    },
  },
  {
    label: "Skaggs spatial information",
    modalities: ["SPIKE", "BEH"],
    category: "SPATIAL",
    triggers: {
      direct: ["Skaggs spatial information", "Skaggs information"],
      indirect: ["spatial information"],
      combination: [],
    },
  },
  {
    label: "cross correlogram",
    modalities: ["SPIKE"],
    category: "RELATIONAL",
    triggers: {
      direct: ["cross correlogram", "cross-correlogram", "CCG"],
      indirect: [],
      combination: [],
    },
  },
  {
    label: "phase locking",
    modalities: ["SPIKE", "LFP"],
    category: "TEMPORAL",
    triggers: {
      direct: ["phase locking", "phase-locking"],
      indirect: ["phase precession"],
      combination: [],
    },
  },
];

const methodCatalog = methodCatalogSeed
  .map(normalizeProfile)
  .filter(Boolean);

module.exports = {
  species: [
    "Long-Evans",
    "Sprague Dawley",
    "Wistar",
    "C57BL/6 mice",
    "mice",
    "rats",
    "Mongolian gerbils",
    "ferrets",
    "primates",
  ],
  brainRegions: [
    "CA1",
    "CA3",
    "CA2",
    "dentate gyrus",
    "subiculum",
    "PFC",
    "mPFC",
    "BLA",
    "amygdala",
    "hippocampus",
    "entorhinal cortex",
    "mEC",
    "olfactory bulb",
    "multi-region",
    "dorsal CA1",
  ],
  behavioralParadigms: [
    "open field",
    "sleep",
    "cheeseboard maze",
    "linear track",
    "T-maze",
    "figure-8 maze",
    "VR",
    "water maze",
    "fear conditioning",
    "reward task",
    "hidden rewards task",
  ],
  recordingMethods: [
    "tetrodes",
    "silicon probes",
    "32 channel silicon probes",
    "64 channel silicon probes",
    "Neuropixels",
    "optrode",
    "calcium imaging",
    "LFP",
    "EEG",
  ],
  cellTypes: [
    "pyramidal",
    "interneuron",
    "place cell",
    "principal",
    "PV+",
    "SST+",
    "VIP+",
    "granule cell",
  ],
  software: [
    "Kilosort",
    "Phy",
    "MATLAB",
    "Python",
    "R",
  ],
  methods: methodCatalog.map((p) => p.label),
  methodCatalog,
  profiles: {
    recordingMethods: [
      { label: "tetrodes", aliases: ["tetrode"] },
      { label: "silicon probes", aliases: ["silicon probe", "shank probe"] },
      {
        label: "Neuropixels",
        aliases: ["Neuropixels 1.0", "Neuropixels 2.0", "NP"],
      },
      { label: "calcium imaging", aliases: ["Ca imaging", "GCaMP"] },
      { label: "optrode", aliases: ["optrodes"] },
      { label: "LFP", aliases: ["local field potential"] },
    ],
  },
};
