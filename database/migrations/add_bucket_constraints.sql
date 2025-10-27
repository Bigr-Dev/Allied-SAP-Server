-- Add unique constraint to prevent duplicate items in bucket
-- This ensures an item can only exist once per plan in the unassigned bucket

-- First, clean up any existing duplicates
WITH duplicates AS (
  SELECT 
    plan_id, 
    item_id,
    MIN(id) as keep_id
  FROM assignment_plan_unassigned_items 
  GROUP BY plan_id, item_id 
  HAVING COUNT(*) > 1
)
DELETE FROM assignment_plan_unassigned_items 
WHERE id NOT IN (SELECT keep_id FROM duplicates)
AND (plan_id, item_id) IN (
  SELECT plan_id, item_id FROM duplicates
);

-- Add unique constraint
ALTER TABLE assignment_plan_unassigned_items 
ADD CONSTRAINT uk_plan_unassigned_item 
UNIQUE (plan_id, item_id);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_plan_unassigned_items_lookup 
ON assignment_plan_unassigned_items (plan_id, item_id);

-- Create function to clean bucket when items are assigned
CREATE OR REPLACE FUNCTION clean_bucket_on_assign()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove from bucket when assigned
  DELETE FROM assignment_plan_unassigned_items 
  WHERE item_id = NEW.item_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-clean bucket
DROP TRIGGER IF EXISTS tr_clean_bucket_on_assign ON assignment_plan_item_assignments;
CREATE TRIGGER tr_clean_bucket_on_assign
  AFTER INSERT ON assignment_plan_item_assignments
  FOR EACH ROW
  EXECUTE FUNCTION clean_bucket_on_assign();

-- Create function to add to bucket when unassigned  
CREATE OR REPLACE FUNCTION add_to_bucket_on_unassign()
RETURNS TRIGGER AS $$
BEGIN
  -- Add to bucket when unassigned (if not already there)
  INSERT INTO assignment_plan_unassigned_items (
    plan_id, 
    item_id, 
    load_id, 
    order_id,
    reason,
    weight_left
  )
  SELECT 
    apu.plan_id,
    OLD.item_id,
    OLD.load_id,
    OLD.order_id,
    'auto_unassigned',
    OLD.assigned_weight_kg
  FROM assignment_plan_units apu
  WHERE apu.id = OLD.plan_unit_id
  ON CONFLICT (plan_id, item_id) DO NOTHING;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-add to bucket
DROP TRIGGER IF EXISTS tr_add_to_bucket_on_unassign ON assignment_plan_item_assignments;
CREATE TRIGGER tr_add_to_bucket_on_unassign
  AFTER DELETE ON assignment_plan_item_assignments
  FOR EACH ROW
  EXECUTE FUNCTION add_to_bucket_on_unassign();