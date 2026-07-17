use tauri_utils::config::Position;

use super::impls::Dimensions;

pub trait PositionTrait {
    fn x(&self) -> u32;
    fn y(&self) -> u32;
    fn set_x(&mut self, val: u32) -> ();
    fn set_y(&mut self, val: u32) -> ();

    fn pos_equal<P>(&self, other: &P) -> bool
    where
        P: PositionTrait,
    {
        self.x() == other.x() && self.y() == other.y()
    }
}

pub trait DimensionsTrait {
    fn x(&self) -> u32;
    fn y(&self) -> u32;
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    fn set_x(&mut self, val: u32) -> ();
    fn set_y(&mut self, val: u32) -> ();
    fn set_width(&mut self, val: u32) -> ();
    fn set_height(&mut self, val: u32) -> ();

    fn intersection_area<D>(&self, dim2: &D) -> u32
    where
        D: DimensionsTrait,
    {
        let x_overlap_start = std::cmp::max(self.x(), dim2.x());
        let x_overlap_end = std::cmp::min(self.x() + self.width(), dim2.x() + dim2.width());
        let y_overlap_start = std::cmp::max(self.y(), dim2.y());
        let y_overlap_end = std::cmp::min(self.y() + self.height(), dim2.y() + dim2.height());

        if x_overlap_start < x_overlap_end && y_overlap_start < y_overlap_end {
            let overlap_width = (x_overlap_end - x_overlap_start) as u32;
            let overlap_height = (y_overlap_end - y_overlap_start) as u32;
            overlap_width * overlap_height
        } else {
            0
        }
    }

    fn clamp_within<D>(&mut self, base: &D) -> Option<()>
    where
        D: DimensionsTrait,
    {
        if self.x() > base.width() || self.y() > base.height() {
            return None;
        }

        if self.x() + self.width() > base.width() {
            self.set_width(self.width() - ((self.x() + self.width()) - base.width()));
        }

        if self.y() + self.height() > base.height() {
            self.set_width(self.height() - ((self.y() + self.height()) - base.height()))
        }

        Some(())
    }

    fn dims_equal<D>(&self, other: &D) -> bool
    where
        D: DimensionsTrait,
    {
        self.x() == other.x()
            && self.y() == other.y()
            && self.width() == other.width()
            && self.height() == other.height()
    }
}

impl<T: DimensionsTrait> PositionTrait for T {
    fn x(&self) -> u32 {
        self.x()
    }

    fn y(&self) -> u32 {
        self.y()
    }

    fn set_x(&mut self, val: u32) -> () {
        self.set_x(val);
    }

    fn set_y(&mut self, val: u32) -> () {
        self.set_y(val);
    }
}

pub trait IntoDimensions {
    fn into_dimensions(self) -> Dimensions;
}

impl<T: DimensionsTrait> IntoDimensions for T {
    fn into_dimensions(self) -> Dimensions {
        Dimensions {
            x: self.x(),
            y: self.y(),
            width: self.width(),
            height: self.height(),
        }
    }
}

pub trait IntoPosition {
    fn into_position(self) -> Position;
}

impl<T: PositionTrait> IntoPosition for T {
    fn into_position(self) -> Position {
        Position {
            x: self.x(),
            y: self.y(),
        }
    }
}

#[macro_export]
macro_rules! impl_basic_position {
    ($struct:ident) => {
        impl PositionTrait for $struct {
            fn x(&self) -> u32 {
                self.x
            }

            fn y(&self) -> u32 {
                self.y
            }

            fn set_x(&mut self, val: u32) -> () {
                self.x = val;
            }

            fn set_y(&mut self, val: u32) -> () {
                self.y = val;
            }
        }
    };
}

#[macro_export]
macro_rules! impl_basic_dimension {
    ($struct:ident) => {
        impl DimensionsTrait for $struct {
            fn x(&self) -> u32 {
                self.x
            }

            fn y(&self) -> u32 {
                self.y
            }

            fn width(&self) -> u32 {
                self.width
            }

            fn height(&self) -> u32 {
                self.height
            }

            fn set_x(&mut self, val: u32) -> () {
                self.x = val;
            }

            fn set_y(&mut self, val: u32) -> () {
                self.y = val;
            }

            fn set_width(&mut self, val: u32) -> () {
                self.width = val;
            }

            fn set_height(&mut self, val: u32) -> () {
                self.height = val;
            }
        }
    };
}
