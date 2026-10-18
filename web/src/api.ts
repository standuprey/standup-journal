const PASSWORD_KEY = 'sj-password';

interface Entry {
  date: string;
  goal: string;
  memory: string;
  seven_ratings: number[];
  created_at: string;
  updated_at: string;
}

export class Api {
  private static isAuthed(): boolean {
    return localStorage.getItem(PASSWORD_KEY) !== null && localStorage.getItem(PASSWORD_KEY) !== "";
  }

  private static savePassword(pw: string): void {
    localStorage.setItem(PASSWORD_KEY, pw);
  }

  private static clearPassword(): void {
    localStorage.removeItem(PASSWORD_KEY);
  }

  static async list(): Promise<Entry[]> {
    const pw = localStorage.getItem(PASSWORD_KEY);
    if (!pw) throw new Error('Authentication required');
    try {
      const res = await fetch('/api/entries', {
        headers: { Authorization: `Bearer ${pw}` }
      });
      if (!res.ok) throw new Error('Network error');
      return await res.json();
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.clearPassword();
        throw new Error('Authentication failed');
      }
      throw error;
    }
  }

  static async get(date: string): Promise<Entry> {
    const pw = localStorage.getItem(PASSWORD_KEY);
    if (!pw) throw new Error('Authentication required');
    try {
      const res = await fetch(`/api/entries/${date}`, {
        headers: { Authorization: `Bearer ${pw}` }
      });
      if (!res.ok) throw new Error('Network error');
      return await res.json();
    } catch (error: any) {
      if (error.response?.status === 701) {
        this.clearPassword();
        throw new Error('Authentication failed');
      }
      throw error;
    }
  }

  static async upsert(date: string, partial: Partial<Entry>): Promise<Entry> {
    const pw = localStorage.getItem(PASSWORD_KEY);
    if (!pw) throw new Error('Authentication required');
    try {
      const res = await fetch(`/api/entries/${date}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${pw}` },
        body: JSON.stringify({ ...partial, seven_ratings: partial.seven_ratings.map(r => Math.min(5, Math.max(0, Math.round(r))) ) })
      });
      if (!res.ok) throw new Error('Network error');
      return await res.json();
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.clearPassword();
        throw new Error('Authentication failed');
      }
      throw error;
    }
  }

  static async remove(date: string): Promise<void> {
    const pw = localStorage.getItem(PASSWORD_KEY);
    if (!pw) throw new Error('Authentication required');
    try {
      const res = await fetch(`/api/entries/${date}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${pw}` }
      });
      if (!res.ok) throw new Error('Network error');
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.clearPassword();
        throw new Error('Authentication failed');
      }
      throw error;
    }
  }
}

// Utility functions
export const isAuthed = Api.isAuthed;
export const savePassword = Api.savePassword;
export const clearPassword = Api.clearPassword;
export const api = Api;