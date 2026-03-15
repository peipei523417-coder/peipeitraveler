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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      frequent_collaborators: {
        Row: {
          collaborator_email: string
          collaborator_name: string | null
          created_at: string
          id: string
          last_used_at: string
          use_count: number
          user_id: string
        }
        Insert: {
          collaborator_email: string
          collaborator_name?: string | null
          created_at?: string
          id?: string
          last_used_at?: string
          use_count?: number
          user_id: string
        }
        Update: {
          collaborator_email?: string
          collaborator_name?: string | null
          created_at?: string
          id?: string
          last_used_at?: string
          use_count?: number
          user_id?: string
        }
        Relationships: []
      }
      itinerary_items: {
        Row: {
          created_at: string
          day_number: number
          description: string
          end_time: string | null
          google_maps_url: string | null
          highlight_color: string | null
          icon_type: string | null
          id: string
          image_url: string | null
          persons: number | null
          price: number | null
          project_id: string
          start_time: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          day_number: number
          description: string
          end_time?: string | null
          google_maps_url?: string | null
          highlight_color?: string | null
          icon_type?: string | null
          id?: string
          image_url?: string | null
          persons?: number | null
          price?: number | null
          project_id: string
          start_time?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          day_number?: number
          description?: string
          end_time?: string | null
          google_maps_url?: string | null
          highlight_color?: string | null
          icon_type?: string | null
          id?: string
          image_url?: string | null
          persons?: number | null
          price?: number | null
          project_id?: string
          start_time?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "public_travel_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "travel_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      password_attempts: {
        Row: {
          created_at: string | null
          id: string
          ip_address: string
          project_id: string
          successful: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          ip_address: string
          project_id: string
          successful?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          ip_address?: string
          project_id?: string
          successful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "password_attempts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "public_travel_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "password_attempts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "travel_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_collaborators: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          project_id: string
          role: Database["public"]["Enums"]["collaborator_role"]
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          project_id: string
          role?: Database["public"]["Enums"]["collaborator_role"]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["collaborator_role"]
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "public_travel_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "travel_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          created_at: string
          created_by: string | null
          default_role: Database["public"]["Enums"]["collaborator_role"]
          expires_at: string | null
          id: string
          password_hash: string | null
          project_id: string
          share_code: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_role?: Database["public"]["Enums"]["collaborator_role"]
          expires_at?: string | null
          id?: string
          password_hash?: string | null
          project_id: string
          share_code: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_role?: Database["public"]["Enums"]["collaborator_role"]
          expires_at?: string | null
          id?: string
          password_hash?: string | null
          project_id?: string
          share_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "public_travel_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "travel_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_group_members: {
        Row: {
          created_at: string
          default_role: Database["public"]["Enums"]["collaborator_role"]
          email: string
          group_id: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          default_role?: Database["public"]["Enums"]["collaborator_role"]
          email: string
          group_id: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          default_role?: Database["public"]["Enums"]["collaborator_role"]
          email?: string
          group_id?: string
          id?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "travel_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "travel_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      travel_projects: {
        Row: {
          cover_image_url: string | null
          created_at: string
          edit_password_hash: string | null
          end_date: string
          id: string
          is_public: boolean
          is_shared: boolean
          name: string
          start_date: string
          updated_at: string
          user_id: string | null
          visibility: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          edit_password_hash?: string | null
          end_date: string
          id?: string
          is_public?: boolean
          is_shared?: boolean
          name: string
          start_date: string
          updated_at?: string
          user_id?: string | null
          visibility?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          edit_password_hash?: string | null
          end_date?: string
          id?: string
          is_public?: boolean
          is_shared?: boolean
          name?: string
          start_date?: string
          updated_at?: string
          user_id?: string | null
          visibility?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          id: string
          is_pro: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_pro?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_pro?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_itinerary_items: {
        Row: {
          created_at: string | null
          day_number: number | null
          description: string | null
          end_time: string | null
          google_maps_url: string | null
          highlight_color: string | null
          icon_type: string | null
          id: string | null
          image_url: string | null
          project_id: string | null
          start_time: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "public_travel_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "travel_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      public_travel_projects: {
        Row: {
          cover_image_url: string | null
          created_at: string | null
          end_date: string | null
          has_edit_password: boolean | null
          id: string | null
          is_public: boolean | null
          name: string | null
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string | null
          end_date?: string | null
          has_edit_password?: never
          id?: string | null
          is_public?: boolean | null
          name?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string | null
          end_date?: string | null
          has_edit_password?: never
          id?: string | null
          is_public?: boolean | null
          name?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_access_project: { Args: { project_id: string }; Returns: boolean }
      can_modify_project: { Args: { project_id: string }; Returns: boolean }
      get_auth_user_email: { Args: never; Returns: string }
      get_public_project: {
        Args: { p_project_id: string }
        Returns: {
          cover_image_url: string
          end_date: string
          has_edit_password: boolean
          is_public: boolean
          project_id: string
          project_name: string
          start_date: string
        }[]
      }
      get_shared_project_by_code: {
        Args: { p_share_code: string }
        Returns: {
          cover_image_url: string
          end_date: string
          project_id: string
          project_name: string
          requires_password: boolean
          start_date: string
        }[]
      }
      is_project_collaborator: {
        Args: { p_project_id: string; p_user_email: string }
        Returns: boolean
      }
      is_project_owner: { Args: { p_project_id: string }; Returns: boolean }
      project_is_public: { Args: { p_project_id: string }; Returns: boolean }
      user_is_editor: { Args: { p_project_id: string }; Returns: boolean }
      user_owns_project: { Args: { p_project_id: string }; Returns: boolean }
      validate_share_link: {
        Args: { p_share_code: string }
        Returns: {
          default_role: string
          expires_at: string
          password_hash: string
          project_id: string
          share_link_id: string
        }[]
      }
      verify_edit_password: {
        Args: { p_password_hash: string; p_project_id: string }
        Returns: boolean
      }
    }
    Enums: {
      collaborator_role: "owner" | "editor" | "viewer"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      collaborator_role: ["owner", "editor", "viewer"],
    },
  },
} as const
