import { describeStoreConformance } from '../testing/store-conformance.js';
import { createMemoryStore } from './memory.js';

describeStoreConformance({ name: 'memory', create: createMemoryStore });
