// Offline storage utilities using IndexedDB
interface OfflineData {
  id: string;
  type: 'compliance' | 'pickup' | 'driver' | 'vehicle';
  data: any;
  timestamp: number;
  synced: boolean;
}

class OfflineStorage {
  private dbName = 'tadweer360-offline';
  private version = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Failed to open IndexedDB');
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        if (!db.objectStoreNames.contains('offlineData')) {
          const store = db.createObjectStore('offlineData', { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async saveData(type: OfflineData['type'], data: any): Promise<string> {
    if (!this.db) {
      await this.init();
    }

    const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const offlineData: OfflineData = {
      id,
      type,
      data,
      timestamp: Date.now(),
      synced: false
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['offlineData'], 'readwrite');
      const store = transaction.objectStore('offlineData');
      const request = store.add(offlineData);

      request.onsuccess = () => {
        console.log(`Offline data saved: ${type}`, id);
        resolve(id);
      };

      request.onerror = () => {
        console.error('Failed to save offline data');
        reject(request.error);
      };
    });
  }

  async getData(type?: OfflineData['type']): Promise<OfflineData[]> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['offlineData'], 'readonly');
      const store = transaction.objectStore('offlineData');
      
      let request: IDBRequest;
      if (type) {
        const index = store.index('type');
        request = index.getAll(type);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('Failed to get offline data');
        reject(request.error);
      };
    });
  }

  async getPendingData(): Promise<OfflineData[]> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['offlineData'], 'readonly');
      const store = transaction.objectStore('offlineData');
      // IndexedDB cannot index on boolean keys, so we read everything and
      // filter unsynced items in JS rather than querying the index with `false`.
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result as OfflineData[];
        resolve(all.filter((item) => !item.synced));
      };

      request.onerror = () => {
        console.error('Failed to get pending data');
        reject(request.error);
      };
    });
  }

  async markAsSynced(id: string): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['offlineData'], 'readwrite');
      const store = transaction.objectStore('offlineData');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const data = getRequest.result;
        if (data) {
          data.synced = true;
          const putRequest = store.put(data);
          
          putRequest.onsuccess = () => {
            console.log(`Data marked as synced: ${id}`);
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(putRequest.error);
          };
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

  async deleteData(id: string): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['offlineData'], 'readwrite');
      const store = transaction.objectStore('offlineData');
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`Offline data deleted: ${id}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to delete offline data');
        reject(request.error);
      };
    });
  }

  async clearSyncedData(): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    const syncedData = await this.getData();
    const syncedItems = syncedData.filter(item => item.synced);

    for (const item of syncedItems) {
      await this.deleteData(item.id);
    }

    console.log(`Cleared ${syncedItems.length} synced items`);
  }
}

export const offlineStorage = new OfflineStorage();

// Utility functions for common operations
export const saveOfflineCompliance = (complianceData: any) => {
  return offlineStorage.saveData('compliance', complianceData);
};

export const saveOfflinePickup = (pickupData: any) => {
  return offlineStorage.saveData('pickup', pickupData);
};

export const saveOfflineDriver = (driverData: any) => {
  return offlineStorage.saveData('driver', driverData);
};

export const saveOfflineVehicle = (vehicleData: any) => {
  return offlineStorage.saveData('vehicle', vehicleData);
};

export const getPendingSync = () => {
  return offlineStorage.getPendingData();
};
