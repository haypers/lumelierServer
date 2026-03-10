//! # Track splitter tree — Server-side evaluation
//!
//! Mirrors the JSON shape from trackSplitterTree.json. Used at go-live and in poll
//! to assign devices to a track (1-based index) by walking the tree: random = proportional
//! draw by percent, gps = branch on is_sending_gps, setTrack = leaf with trackId.

use rand::Rng;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct TrackSplitterTree {
    pub root: TrackSplitterNode,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type")]
pub enum TrackSplitterNode {
    #[serde(rename = "random")]
    Random {
        children: Vec<RandomChild>,
    },
    #[serde(rename = "gps")]
    Gps {
        compatible: Box<TrackSplitterNode>,
        incompatible: Box<TrackSplitterNode>,
    },
    #[serde(rename = "setTrack")]
    SetTrack {
        #[serde(rename = "trackId")]
        track_id: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
pub struct RandomChild {
    pub percent: u32,
    pub node: TrackSplitterNode,
}

/// Evaluate the tree and return the 1-based track index. Uses `is_sending_gps` at GPS nodes.
/// Uses `rng` for random splits. Returns 1 if the tree is invalid or empty.
pub fn evaluate<R: Rng>(
    tree: &TrackSplitterTree,
    is_sending_gps: bool,
    rng: &mut R,
) -> u32 {
    evaluate_node(&tree.root, is_sending_gps, rng)
}

fn evaluate_node<R: Rng>(node: &TrackSplitterNode, is_sending_gps: bool, rng: &mut R) -> u32 {
    match node {
        TrackSplitterNode::SetTrack { track_id } => {
            track_id
                .trim()
                .parse::<u32>()
                .ok()
                .filter(|&n| n >= 1)
                .unwrap_or(1)
        }
        TrackSplitterNode::Gps {
            compatible,
            incompatible,
        } => {
            if is_sending_gps {
                evaluate_node(compatible, is_sending_gps, rng)
            } else {
                evaluate_node(incompatible, is_sending_gps, rng)
            }
        }
        TrackSplitterNode::Random { children } => {
            if children.is_empty() {
                return 1;
            }
            let sum: u32 = children.iter().map(|c| c.percent).sum();
            if sum == 0 {
                return evaluate_node(&children[0].node, is_sending_gps, rng);
            }
            let draw: f64 = rng.gen_range(0.0..sum as f64);
            let mut acc = 0.0f64;
            for child in children {
                acc += child.percent as f64;
                if draw < acc {
                    return evaluate_node(&child.node, is_sending_gps, rng);
                }
            }
            evaluate_node(&children[children.len() - 1].node, is_sending_gps, rng)
        }
    }
}
