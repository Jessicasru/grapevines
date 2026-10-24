export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_admin: boolean
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_admin?: boolean
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          author_name: string
          created_at: string
          id: string
          merge_preserved: boolean
          note: string
          user_id: string | null
          verdict: string
          winery_id: string
          wines_to_try: string | null
        }
        Insert: {
          author_name: string
          created_at?: string
          id?: string
          merge_preserved?: boolean
          note?: string
          user_id?: string | null
          verdict: string
          winery_id: string
          wines_to_try?: string | null
        }
        Update: {
          author_name?: string
          created_at?: string
          id?: string
          merge_preserved?: boolean
          note?: string
          user_id?: string | null
          verdict?: string
          winery_id?: string
          wines_to_try?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_winery_id_fkey"
            columns: ["winery_id"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          boundary: unknown
          center_lat: number
          center_lng: number
          country: string
          created_at: string
          default_zoom: number
          id: string
          name: string
        }
        Insert: {
          boundary?: unknown
          center_lat: number
          center_lng: number
          country: string
          created_at?: string
          default_zoom?: number
          id?: string
          name: string
        }
        Update: {
          boundary?: unknown
          center_lat?: number
          center_lng?: number
          country?: string
          created_at?: string
          default_zoom?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      saves: {
        Row: {
          created_at: string
          id: string
          status: string
          user_id: string
          winery_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status: string
          user_id: string
          winery_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          user_id?: string
          winery_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saves_winery_id_fkey"
            columns: ["winery_id"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
        ]
      }
      wineries: {
        Row: {
          address: string | null
          appointment_required: boolean
          booking_required: boolean | null
          created_at: string
          created_by: string | null
          description: string | null
          enrichment_confidence: number | null
          enrichment_evidence: Json | null
          enrichment_status: string
          featured: boolean
          id: string
          languages: string[]
          last_verified_at: string | null
          latitude: number
          longitude: number
          merged_into: string | null
          name: string
          opening_days: string | null
          opening_hours: string | null
          phone: string | null
          photo_url: string | null
          region_id: string
          review_status: string
          ships_abroad: boolean
          sources: Json | null
          tasting_fee: string | null
          village: string | null
          visitable: boolean | null
          website: string | null
        }
        Insert: {
          address?: string | null
          appointment_required?: boolean
          booking_required?: boolean | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enrichment_confidence?: number | null
          enrichment_evidence?: Json | null
          enrichment_status?: string
          featured?: boolean
          id?: string
          languages?: string[]
          last_verified_at?: string | null
          latitude: number
          longitude: number
          merged_into?: string | null
          name: string
          opening_days?: string | null
          opening_hours?: string | null
          phone?: string | null
          photo_url?: string | null
          region_id: string
          review_status?: string
          ships_abroad?: boolean
          sources?: Json | null
          tasting_fee?: string | null
          village?: string | null
          visitable?: boolean | null
          website?: string | null
        }
        Update: {
          address?: string | null
          appointment_required?: boolean
          booking_required?: boolean | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enrichment_confidence?: number | null
          enrichment_evidence?: Json | null
          enrichment_status?: string
          featured?: boolean
          id?: string
          languages?: string[]
          last_verified_at?: string | null
          latitude?: number
          longitude?: number
          merged_into?: string | null
          name?: string
          opening_days?: string | null
          opening_hours?: string | null
          phone?: string | null
          photo_url?: string | null
          region_id?: string
          review_status?: string
          ships_abroad?: boolean
          sources?: Json | null
          tasting_fee?: string | null
          village?: string | null
          visitable?: boolean | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wineries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wineries_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wineries_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      winery_duplicate_dismissals: {
        Row: {
          created_at: string
          dismissed_by: string | null
          reason: string
          winery_a: string
          winery_b: string
        }
        Insert: {
          created_at?: string
          dismissed_by?: string | null
          reason?: string
          winery_a: string
          winery_b: string
        }
        Update: {
          created_at?: string
          dismissed_by?: string | null
          reason?: string
          winery_a?: string
          winery_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "winery_duplicate_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "winery_duplicate_dismissals_winery_a_fkey"
            columns: ["winery_a"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "winery_duplicate_dismissals_winery_b_fkey"
            columns: ["winery_b"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
        ]
      }
      winery_duplicate_previews: {
        Row: {
          applied_at: string | null
          created_at: string
          id: string
          pairs: Json
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          id?: string
          pairs: Json
          user_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          id?: string
          pairs?: Json
          user_id?: string
        }
        Relationships: []
      }
      winery_merge_history: {
        Row: {
          after_state: Json
          before_state: Json
          created_at: string
          id: string
          kept_id: string
          merged_by: string | null
          mode: string
          removed_id: string
          undone_at: string | null
        }
        Insert: {
          after_state: Json
          before_state: Json
          created_at?: string
          id?: string
          kept_id: string
          merged_by?: string | null
          mode?: string
          removed_id: string
          undone_at?: string | null
        }
        Update: {
          after_state?: Json
          before_state?: Json
          created_at?: string
          id?: string
          kept_id?: string
          merged_by?: string | null
          mode?: string
          removed_id?: string
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "winery_merge_history_kept_id_fkey"
            columns: ["kept_id"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "winery_merge_history_removed_id_fkey"
            columns: ["removed_id"]
            isOneToOne: false
            referencedRelation: "wineries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_winery_duplicates: { Args: { _preview: string }; Returns: Json }
      dismiss_winery_duplicate: {
        Args: { _a: string; _b: string }
        Returns: undefined
      }
      duplicate_address: { Args: { _w: Json }; Returns: Json }
      duplicate_classification: {
        Args: { _a: Json; _b: Json }
        Returns: string
      }
      duplicate_filled_count: { Args: { _w: Json }; Returns: number }
      duplicate_has_source: {
        Args: { _source: string; _w: Json }
        Returns: boolean
      }
      duplicate_house_matches: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      duplicate_osm_only: { Args: { _w: Json }; Returns: boolean }
      duplicate_review_history: { Args: never; Returns: Json }
      duplicate_state: { Args: { _a: string; _b: string }; Returns: Json }
      duplicate_street: { Args: { _value: string }; Returns: string }
      duplicate_unique_osm: {
        Args: { _pair: Json; _pairs: Json }
        Returns: boolean
      }
      import_csv_wineries: {
        Args: { _rows: Json; _source: string }
        Returns: Json
      }
      import_osm_wineries: { Args: { _elements: Json }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      merge_winery_duplicate: {
        Args: { _keep: string; _remove: string }
        Returns: string
      }
      normalized_winery_name: { Args: { _name: string }; Returns: string }
      preview_winery_duplicates: { Args: never; Returns: Json }
      region_boundaries: {
        Args: never
        Returns: {
          geojson: Json
          id: string
        }[]
      }
      restore_winery_duplicate: {
        Args: { _a: string; _b: string }
        Returns: undefined
      }
      set_region_boundary: {
        Args: { _geojson: Json; _region_id: string }
        Returns: number
      }
      undo_winery_merge: { Args: { _id: string }; Returns: undefined }
      winery_duplicate_candidates: { Args: never; Returns: Json }
      winery_names_match: { Args: { _a: string; _b: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
